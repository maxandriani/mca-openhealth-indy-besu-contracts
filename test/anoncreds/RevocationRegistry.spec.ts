import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import {
  bytes,
  credentialDefinitionData,
  deployRevocationStack,
  revocationDefinitionData,
  schemaData,
} from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const stack = await deployRevocationStack(viem)
  const { trustee, trustee2 } = stack.accounts
  const identity = trustee.account.address
  const issuerId = `did:ethr:${identity}`
  const schema = schemaData(issuerId)
  await stack.schemaRegistry.write.createSchema([identity, schema.id, issuerId, schema.data], {
    account: trustee.account,
  })
  const credDef = credentialDefinitionData(issuerId, schema.id)
  await stack.credentialDefinitionRegistry.write.createCredentialDefinition(
    [identity, credDef.id, issuerId, schema.id, credDef.data],
    { account: trustee.account },
  )
  return { ...stack, trustee, trustee2, identity, issuerId, schemaId: schema.id, credDefId: credDef.id }
}

describe('RevocationRegistry', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('creates and resolves a revocation registry definition', async function () {
    const { revocationRegistry, trustee, identity, issuerId, credDefId } = fixture
    const definition = revocationDefinitionData(issuerId, credDefId)
    await revocationRegistry.write.createRevocationRegistryDefinition(
      [identity, definition.id, credDefId, issuerId, definition.data],
      { account: trustee.account },
    )
    const result = await revocationRegistry.read.resolveRevocationRegistryDefinition([definition.id])
    assert.equal(result.revRegDef, definition.data)
    assert.equal(result.metadata.issuerId, issuerId)
  })

  it('rejects invalid issuers and missing credential definitions', async function () {
    const { viem, revocationRegistry, credentialDefinitionRegistry, trustee, identity, issuerId, credDefId } = fixture
    const invalidIssuerId = 'did:ethr:ab$ddfgh354345'
    const definition = revocationDefinitionData(invalidIssuerId, credDefId)
    await viem.assertions.revertWithCustomErrorWithArgs(
      revocationRegistry.write.createRevocationRegistryDefinition(
        [identity, definition.id, credDefId, invalidIssuerId, definition.data],
        { account: trustee.account },
      ),
      revocationRegistry,
      'InvalidIssuerId',
      [invalidIssuerId],
    )

    const missingCredDefId = `0x${'11'.repeat(32)}` as `0x${string}`
    const missingDefinition = revocationDefinitionData(issuerId, missingCredDefId)
    await viem.assertions.revertWithCustomErrorWithArgs(
      revocationRegistry.write.createRevocationRegistryDefinition(
        [identity, missingDefinition.id, missingCredDefId, issuerId, missingDefinition.data],
        { account: trustee.account },
      ),
      credentialDefinitionRegistry,
      'CredentialDefinitionNotFound',
      [missingCredDefId],
    )
  })

  it('rejects duplicate definitions and resolves unknown definitions with an error', async function () {
    const { viem, revocationRegistry, trustee, identity, issuerId, credDefId } = fixture
    const definition = revocationDefinitionData(issuerId, credDefId)
    const args = [identity, definition.id, credDefId, issuerId, definition.data] as const
    await revocationRegistry.write.createRevocationRegistryDefinition(args, { account: trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      revocationRegistry.write.createRevocationRegistryDefinition(args, { account: trustee.account }),
      revocationRegistry,
      'RevocationRegistryDefinitionAlreadyExist',
      [definition.id],
    )
    const unknownId = `0x${'22'.repeat(32)}` as `0x${string}`
    await viem.assertions.revertWithCustomErrorWithArgs(
      revocationRegistry.read.resolveRevocationRegistryDefinition([unknownId]),
      revocationRegistry,
      'RevocationRegistryDefinitionNotFound',
      [unknownId],
    )
  })

  it('records revocation entries and updates the last event block', async function () {
    const { viem, revocationRegistry, trustee, identity, issuerId, credDefId } = fixture
    const definition = revocationDefinitionData(issuerId, credDefId)
    await revocationRegistry.write.createRevocationRegistryDefinition(
      [identity, definition.id, credDefId, issuerId, definition.data],
      { account: trustee.account },
    )
    const entry = bytes(JSON.stringify({
      revRegDefId: definition.id,
      currentAccumulator: '0x20',
      issued: [2, 3],
      revoked: [0, 1],
    }))
    const hash = await revocationRegistry.write.createRevocationRegistryEntry(
      [identity, definition.id, issuerId, entry],
      { account: trustee.account },
    )
    const receipt = await (await viem.getPublicClient()).getTransactionReceipt({ hash })
    const blockNumber = await revocationRegistry.read.getLastEventBlockNumber([definition.id])
    assert.equal(blockNumber, receipt.blockNumber)
    assert.ok(blockNumber > 0n)
  })

  it('rejects a non-owner and an unrelated issuer when recording revocation entries', async function () {
    const { viem, revocationRegistry, indyDidRegistry, trustee, trustee2, identity, issuerId, credDefId } = fixture
    const definition = revocationDefinitionData(issuerId, credDefId)
    await revocationRegistry.write.createRevocationRegistryDefinition(
      [identity, definition.id, credDefId, issuerId, definition.data],
      { account: trustee.account },
    )
    const entry = bytes(JSON.stringify({ accumulator: '0x20' }))
    await viem.assertions.revertWithCustomError(
      revocationRegistry.write.createRevocationRegistryEntry(
        [trustee2.account.address, definition.id, issuerId, entry],
        { account: trustee2.account },
      ),
      revocationRegistry,
      'NotIdentityOwner',
    )

    const otherIssuerId = `did:indybesu:${identity}`
    await indyDidRegistry.write.createDid(
      [identity, bytes(JSON.stringify({ id: otherIssuerId }))],
      { account: trustee.account },
    )
    await viem.assertions.revertWithCustomErrorWithArgs(
      revocationRegistry.write.createRevocationRegistryEntry(
        [identity, definition.id, otherIssuerId, entry],
        { account: trustee.account },
      ),
      revocationRegistry,
      'NotRevocationRegistryDefinitionIssuer',
      [otherIssuerId],
    )
  })
})
