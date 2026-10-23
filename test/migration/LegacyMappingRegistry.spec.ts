import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import { stringToBytes, toHex } from 'viem'
import {
  deployLegacyStack,
  signatureArgs,
  signEndorsement,
  testActor,
} from '../utils/viem-helpers.js'

const legacyDid = '2vZAi1riCVGnQMfQAjbThG'
const legacyKey = '0x0f9361df40b3bc46a26edba3b919b417e0af0fbcebaae9f0916fcc996c75bc91' as `0x${string}`
const legacySignature = '0x'
const legacySchemaId = `${legacyDid}:2:test_credential:1.0.0`
const schemaId = 'did:ethr:0xcb799c9bca0d1ce7385726ccbd40b9fc4313e5b1/anoncreds/v0/SCHEMA/test_credential/1.0.0'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const stack = await deployLegacyStack(viem)
  const { trustee } = stack.accounts
  const identity = trustee.account.address
  const newDid = `did:indybesu:${identity}`
  await stack.indyDidRegistry.write.createDid(
    [identity, toHex(stringToBytes(JSON.stringify({ id: newDid })))],
    { account: trustee.account },
  )
  return { ...stack, trustee, identity, newDid }
}

describe('LegacyMappingRegistry', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('creates and resolves a DID mapping', async function () {
    const { legacyMappingRegistry, trustee, identity, newDid } = fixture
    await legacyMappingRegistry.write.createDidMapping(
      [identity, legacyDid, newDid, legacyKey, legacySignature],
      { account: trustee.account },
    )
    assert.equal(await legacyMappingRegistry.read.didMapping([legacyDid]), newDid)
  })

  it('rejects duplicate DID mappings, invalid keys, and non-owners', async function () {
    const { viem, legacyMappingRegistry, trustee, identity, newDid, accounts } = fixture
    const mapping = [identity, legacyDid, newDid, legacyKey, legacySignature] as const
    const wrongKey = `${'0x' + '11'.repeat(32)}` as `0x${string}`
    await viem.assertions.revertWithCustomError(
      legacyMappingRegistry.write.createDidMapping(
        [identity, legacyDid, newDid, wrongKey, legacySignature],
        { account: trustee.account },
      ),
      legacyMappingRegistry,
      'InvalidEd25519Key',
    )
    await legacyMappingRegistry.write.createDidMapping(mapping, { account: trustee.account })
    await viem.assertions.revertWithCustomError(
      legacyMappingRegistry.write.createDidMapping(mapping, { account: trustee.account }),
      legacyMappingRegistry,
      'DidMappingAlreadyExist',
    )
    await viem.assertions.revertWithCustomError(
      legacyMappingRegistry.write.createDidMapping(mapping, { account: accounts.trustee2.account }),
      legacyMappingRegistry,
      'NotIdentityOwner',
    )
  })

  it('creates and resolves resource mappings for an existing DID mapping', async function () {
    const { legacyMappingRegistry, trustee, identity, newDid } = fixture
    await legacyMappingRegistry.write.createDidMapping(
      [identity, legacyDid, newDid, legacyKey, legacySignature],
      { account: trustee.account },
    )
    await legacyMappingRegistry.write.createResourceMapping(
      [identity, legacyDid, legacySchemaId, schemaId],
      { account: trustee.account },
    )
    assert.equal(await legacyMappingRegistry.read.resourceMapping([legacySchemaId]), schemaId)
  })

  it('rejects duplicate resource mappings and missing legacy DID mappings', async function () {
    const { viem, legacyMappingRegistry, trustee, identity, newDid } = fixture
    await legacyMappingRegistry.write.createDidMapping(
      [identity, legacyDid, newDid, legacyKey, legacySignature],
      { account: trustee.account },
    )
    const mapping = [identity, legacyDid, legacySchemaId, schemaId] as const
    await legacyMappingRegistry.write.createResourceMapping(mapping, { account: trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      legacyMappingRegistry.write.createResourceMapping(mapping, { account: trustee.account }),
      legacyMappingRegistry,
      'ResourceMappingAlreadyExist',
      [legacySchemaId],
    )
    await viem.assertions.revertWithCustomError(
      legacyMappingRegistry.write.createResourceMapping(
        [identity, 'missing-did', `${legacySchemaId}-missing`, schemaId],
        { account: trustee.account },
      ),
      legacyMappingRegistry,
      'DidMappingDoesNotExist',
    )
  })

  it('supports endorsed DID and resource mappings', async function () {
    const { legacyMappingRegistry, trustee } = fixture
    const identity = testActor.address
    const did = `did:ethr:${identity}`
    const signature = await signEndorsement(
      legacyMappingRegistry.address,
      identity,
      'createDidMapping',
      ['string', 'string', 'bytes32', 'bytes'],
      [legacyDid, did, legacyKey, legacySignature],
    )
    await legacyMappingRegistry.write.createDidMappingSigned(
      [identity, ...signatureArgs(signature), legacyDid, did, legacyKey, legacySignature],
      { account: trustee.account },
    )
    const mappingSignature = await signEndorsement(
      legacyMappingRegistry.address,
      identity,
      'createResourceMapping',
      ['string', 'string', 'string'],
      [legacyDid, legacySchemaId, schemaId],
    )
    await legacyMappingRegistry.write.createResourceMappingSigned(
      [identity, ...signatureArgs(mappingSignature), legacyDid, legacySchemaId, schemaId],
      { account: trustee.account },
    )
    assert.equal(await legacyMappingRegistry.read.didMapping([legacyDid]), did)
    assert.equal(await legacyMappingRegistry.read.resourceMapping([legacySchemaId]), schemaId)
  })
})
