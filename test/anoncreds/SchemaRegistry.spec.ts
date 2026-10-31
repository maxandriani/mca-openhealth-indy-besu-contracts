import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import { keccak256 } from 'viem'
import {
  bytes,
  deploySchemaStack,
  makeDidDocument,
  schemaData,
  signatureArgs,
  signEndorsement,
  testActor,
} from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const stack = await deploySchemaStack(viem)
  const { trustee, trustee2, noRole } = stack.accounts
  const identity = trustee.account.address
  const issuerId = `did:indy:besu:mainnet:${identity}`
  await stack.indyDidRegistry.write.createDid(
    [identity, makeDidDocument(issuerId)],
    { account: trustee.account },
  )
  return { ...stack, trustee, trustee2, noRole, identity, issuerId }
}

describe('SchemaRegistry', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('creates and resolves a schema', async function () {
    const { schemaRegistry, trustee, identity, issuerId } = fixture
    const schema = schemaData(issuerId)
    await schemaRegistry.write.createSchema([identity, schema.id, issuerId, schema.data], {
      account: trustee.account,
    })
    assert.equal((await schemaRegistry.read.resolveSchema([schema.id])).schema, schema.data)
  })

  it('rejects missing and duplicate schemas', async function () {
    const { viem, schemaRegistry, trustee, identity, issuerId } = fixture
    const schema = schemaData(issuerId)
    await viem.assertions.revertWithCustomErrorWithArgs(
      schemaRegistry.read.resolveSchema([schema.id]),
      schemaRegistry,
      'SchemaNotFound',
      [schema.id],
    )
    await schemaRegistry.write.createSchema([identity, schema.id, issuerId, schema.data], {
      account: trustee.account,
    })
    await viem.assertions.revertWithCustomErrorWithArgs(
      schemaRegistry.write.createSchema([identity, schema.id, issuerId, schema.data], {
        account: trustee.account,
      }),
      schemaRegistry,
      'SchemaAlreadyExist',
      [schema.id],
    )
  })

  it('rejects unknown and deactivated issuers', async function () {
    const { viem, schemaRegistry, indyDidRegistry, trustee, noRole, identity, issuerId } = fixture
    const unknownIssuerId = `did:indy:besu:mainnet:${noRole.account.address}`
    const unknownSchema = schemaData(unknownIssuerId)
    await viem.assertions.revertWithCustomErrorWithArgs(
      schemaRegistry.write.createSchema([identity, unknownSchema.id, unknownIssuerId, unknownSchema.data], {
        account: trustee.account,
      }),
      schemaRegistry,
      'IssuerNotFound',
      [unknownIssuerId],
    )

    await indyDidRegistry.write.deactivateDid([identity], { account: trustee.account })
    const inactiveSchema = schemaData(issuerId, 'inactive')
    await viem.assertions.revertWithCustomErrorWithArgs(
      schemaRegistry.write.createSchema([identity, inactiveSchema.id, issuerId, inactiveSchema.data], {
        account: trustee.account,
      }),
      schemaRegistry,
      'IssuerHasBeenDeactivated',
      [issuerId],
    )
  })

  it('rejects invalid and not-owned Ethereum issuer DIDs', async function () {
    const { viem, schemaRegistry, trustee, trustee2 } = fixture
    const invalidIssuerId = 'did:ethr:ab$ddfgh354345'
    const invalidSchema = schemaData(invalidIssuerId)
    await viem.assertions.revertWithCustomErrorWithArgs(
      schemaRegistry.write.createSchema(
        [trustee.account.address, invalidSchema.id, invalidIssuerId, invalidSchema.data],
        { account: trustee.account },
      ),
      schemaRegistry,
      'InvalidIssuerId',
      [invalidIssuerId],
    )

    const otherIssuerId = `did:ethr:${trustee2.account.address}`
    const schema = schemaData(otherIssuerId)
    await viem.assertions.revertWithCustomError(
      schemaRegistry.write.createSchema(
        [trustee.account.address, schema.id, otherIssuerId, schema.data],
        { account: trustee.account },
      ),
      schemaRegistry,
      'NotIdentityOwner',
    )
  })

  it('rejects schema creation by an account without a role', async function () {
    const { viem, schemaRegistry, roleControl, noRole, identity, issuerId } = fixture
    const schema = schemaData(issuerId)
    await viem.assertions.revertWithCustomErrorWithArgs(
      schemaRegistry.write.createSchema([identity, schema.id, issuerId, schema.data], {
        account: noRole.account,
      }),
      roleControl,
      'Unauthorized',
      [noRole.account.address],
    )
  })

  it('supports signed schema creation for Ethereum DIDs', async function () {
    const { schemaRegistry, trustee } = fixture
    const issuerId = `did:ethr:${testActor.address}`
    const schema = schemaData(issuerId)
    const signature = await signEndorsement(
      schemaRegistry.address,
      testActor.address,
      'createSchema',
      ['bytes32', 'string', 'bytes'],
      [schema.id, issuerId, schema.data],
    )
    await schemaRegistry.write.createSchemaSigned(
      [testActor.address, ...signatureArgs(signature), schema.id, issuerId, schema.data],
      { account: trustee.account },
    )
    assert.equal((await schemaRegistry.read.resolveSchema([schema.id])).schema, schema.data)
  })

  it('supports signed schema creation for Indy Besu DIDs', async function () {
    const { schemaRegistry, indyDidRegistry, trustee } = fixture
    const issuerId = `did:indy:besu:${testActor.address}`
    const document = makeDidDocument(issuerId)
    const didSignature = await signEndorsement(
      indyDidRegistry.address,
      testActor.address,
      'createDid',
      ['bytes'],
      [document],
    )
    await indyDidRegistry.write.createDidSigned(
      [testActor.address, ...signatureArgs(didSignature), document],
      { account: trustee.account },
    )
    const schema = schemaData(issuerId)
    const signature = await signEndorsement(
      schemaRegistry.address,
      testActor.address,
      'createSchema',
      ['bytes32', 'string', 'bytes'],
      [schema.id, issuerId, schema.data],
    )
    await schemaRegistry.write.createSchemaSigned(
      [testActor.address, ...signatureArgs(signature), schema.id, issuerId, schema.data],
      { account: trustee.account },
    )
    assert.equal((await schemaRegistry.read.resolveSchema([schema.id])).schema, schema.data)
  })

  it('rejects signed schemas when the signer or signed data is incorrect', async function () {
    const { viem, schemaRegistry, trustee, trustee2 } = fixture
    const issuerId = `did:ethr:${testActor.address}`
    const schema = schemaData(issuerId)
    const signature = await signEndorsement(
      schemaRegistry.address,
      testActor.address,
      'createSchema',
      ['bytes32', 'string', 'bytes'],
      [schema.id, issuerId, schema.data],
    )
    await viem.assertions.revertWithCustomError(
      schemaRegistry.write.createSchemaSigned(
        [trustee2.account.address, ...signatureArgs(signature), schema.id, issuerId, schema.data],
        { account: trustee.account },
      ),
      schemaRegistry,
      'NotIdentityOwner',
    )

    const invalidSignature = await signEndorsement(
      schemaRegistry.address,
      testActor.address,
      'createSchema',
      ['bytes32', 'string', 'bytes'],
      [keccak256(bytes('wrong-id')), issuerId, schema.data],
    )
    await viem.assertions.revertWithCustomError(
      schemaRegistry.write.createSchemaSigned(
        [testActor.address, ...signatureArgs(invalidSignature), schema.id, issuerId, schema.data],
        { account: trustee.account },
      ),
      schemaRegistry,
      'NotIdentityOwner',
    )
  })
})
