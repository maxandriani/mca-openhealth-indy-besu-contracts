/**
 * Copyright (c) 2024 DSR Corporation, Denver, Colorado.
 * https://www.dsr-corporation.com
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import {
  encodePacked,
  keccak256,
  parseSignature,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const testActor = privateKeyToAccount('0xa285ab66393c5fdda46d6fbad9e27fafd438254ab72ad5acb681a0e9f20f5d7b')

type Fixture = Awaited<ReturnType<typeof deployFixture>>

async function deployFixture() {
  const { viem } = await network.create()
  const [, trustee, trustee2, noRole] = await viem.getWalletClients()

  const roleControl = await viem.deployContract('RoleControl')
  await roleControl.write.initialize([ZERO_ADDRESS])
  await roleControl.write.assignRole([1, trustee.account.address])
  await roleControl.write.assignRole([1, trustee2.account.address])

  const indyDidRegistry = await viem.deployContract('IndyDidRegistry')
  await indyDidRegistry.write.initialize([ZERO_ADDRESS, roleControl.address])

  const ethereumDidRegistry = await viem.deployContract('EthereumExtDidRegistry')
  await ethereumDidRegistry.write.initialize([ZERO_ADDRESS])

  const universalDidResolver = await viem.deployContract('UniversalDidResolver')
  await universalDidResolver.write.initialize([
    ZERO_ADDRESS,
    indyDidRegistry.address,
    ethereumDidRegistry.address,
  ])

  const schemaRegistry = await viem.deployContract('SchemaRegistry')
  await schemaRegistry.write.initialize([
    ZERO_ADDRESS,
    universalDidResolver.address,
    roleControl.address,
  ])

  const credentialDefinitionRegistry = await viem.deployContract('CredentialDefinitionRegistry')
  await credentialDefinitionRegistry.write.initialize([
    ZERO_ADDRESS,
    universalDidResolver.address,
    schemaRegistry.address,
    roleControl.address,
  ])

  const issuerAddress = trustee.account.address
  const issuerId = `did:indy:besu:mainnet:${issuerAddress}`
  const didDocument = toHex(stringToBytes(JSON.stringify({ id: issuerId })))
  await indyDidRegistry.write.createDid([issuerAddress, didDocument], { account: trustee.account })

  const schema = schemaData('issuer-schema')
  await schemaRegistry.write.createSchema(
    [issuerAddress, schema.id, issuerId, schema.data],
    { account: trustee.account },
  )

  return {
    viem,
    trustee,
    trustee2,
    noRole,
    roleControl,
    indyDidRegistry,
    schemaRegistry,
    credentialDefinitionRegistry,
    issuerAddress,
    issuerId,
    schemaId: schema.id,
  }
}

function schemaData(name: string) {
  const id = keccak256(stringToBytes(`did:indy:besu:anoncreds/v0/SCHEMA/${name}/1.0.0`))
  const data = toHex(stringToBytes(JSON.stringify({ name, version: '1.0.0', attrNames: ['name'] })))
  return { id, data }
}

function credentialDefinitionData(issuerId: string, schemaId: Hex, name = 'test') {
  const id = keccak256(stringToBytes(`${issuerId}/anoncreds/v0/CLAIM_DEF/${name}/1.0.0`))
  const data = toHex(stringToBytes(JSON.stringify({ id: name, schemaId, type: 'CL' })))
  return { id, data }
}

function signatureArgs(signature: ReturnType<typeof parseSignature>) {
  return [Number(signature.v), signature.r, signature.s] as const
}

async function signCreateDid(
  registryAddress: Address,
  identity: Address,
  document: Hex,
) {
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'bytes1', 'address', 'address', 'string', 'bytes'],
      ['0x19', '0x00', registryAddress, identity, 'createDid', document],
    ),
  )
  return parseSignature(await testActor.sign({ hash }))
}

async function signCreateSchema(
  registryAddress: Address,
  identity: Address,
  id: Hex,
  issuerId: string,
  schema: Hex,
) {
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'bytes1', 'address', 'address', 'string', 'bytes32', 'string', 'bytes'],
      ['0x19', '0x00', registryAddress, identity, 'createSchema', id, issuerId, schema],
    ),
  )
  return parseSignature(await testActor.sign({ hash }))
}

async function signCreateCredentialDefinition(
  registryAddress: Address,
  identity: Address,
  id: Hex,
  issuerId: string,
  schemaId: Hex,
  credentialDefinition: Hex,
) {
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'bytes1', 'address', 'address', 'string', 'bytes32', 'string', 'bytes32', 'bytes'],
      [
        '0x19',
        '0x00',
        registryAddress,
        identity,
        'createCredentialDefinition',
        id,
        issuerId,
        schemaId,
        credentialDefinition,
      ],
    ),
  )
  return parseSignature(await testActor.sign({ hash }))
}

describe('CredentialDefinitionRegistry', async function () {
  let fixture: Fixture

  beforeEach(async function () {
    fixture = await deployFixture()
  })

  describe('Add/Resolve Credential Definition', function () {
    it('creates and resolves a Credential Definition', async function () {
      const { credentialDefinitionRegistry, trustee, issuerId, schemaId } = fixture
      const { id, data } = credentialDefinitionData(issuerId, schemaId)

      await credentialDefinitionRegistry.write.createCredentialDefinition(
        [trustee.account.address, id, issuerId, schemaId, data],
        { account: trustee.account },
      )
      const result = await credentialDefinitionRegistry.read.resolveCredentialDefinition([id])

      assert.equal(result.credDef, data)
      assert.ok(result.metadata.created > 0n)
    })

    it('reverts when resolving a Credential Definition that does not exist', async function () {
      const { viem, credentialDefinitionRegistry, issuerId, schemaId } = fixture
      const { id } = credentialDefinitionData(issuerId, schemaId)

      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.read.resolveCredentialDefinition([id]),
        credentialDefinitionRegistry,
        'CredentialDefinitionNotFound',
        [id],
      )
    })

    it('reverts when a Credential Definition already exists', async function () {
      const { viem, credentialDefinitionRegistry, trustee, issuerId, schemaId } = fixture
      const { id, data } = credentialDefinitionData(issuerId, schemaId)
      const args = [trustee.account.address, id, issuerId, schemaId, data] as const

      await credentialDefinitionRegistry.write.createCredentialDefinition(args, { account: trustee.account })
      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.write.createCredentialDefinition(args, { account: trustee.account }),
        credentialDefinitionRegistry,
        'CredentialDefinitionAlreadyExist',
        [id],
      )
    })

    it('reverts when the issuer does not exist', async function () {
      const { viem, credentialDefinitionRegistry, trustee, noRole, schemaId } = fixture
      const unknownIssuerId = `did:indy:besu:mainnet:${noRole.account.address}`
      const { id, data } = credentialDefinitionData(unknownIssuerId, schemaId)

      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [trustee.account.address, id, unknownIssuerId, schemaId, data],
          { account: trustee.account },
        ),
        credentialDefinitionRegistry,
        'IssuerNotFound',
        [unknownIssuerId],
      )
    })

    it('reverts when the issuer DID has been deactivated', async function () {
      const { viem, credentialDefinitionRegistry, indyDidRegistry, trustee, issuerAddress, issuerId, schemaId } =
        fixture
      const { id, data } = credentialDefinitionData(issuerId, schemaId)

      await indyDidRegistry.write.deactivateDid([issuerAddress], { account: trustee.account })
      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [issuerAddress, id, issuerId, schemaId, data],
          { account: trustee.account },
        ),
        credentialDefinitionRegistry,
        'IssuerHasBeenDeactivated',
        [issuerId],
      )
    })

    it('reverts when the referenced Schema does not exist', async function () {
      const { viem, credentialDefinitionRegistry, trustee, issuerId } = fixture
      const unknownSchemaId = keccak256(stringToBytes('missing-schema'))
      const { id, data } = credentialDefinitionData(issuerId, unknownSchemaId)

      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [trustee.account.address, id, issuerId, unknownSchemaId, data],
          { account: trustee.account },
        ),
        fixture.schemaRegistry,
        'SchemaNotFound',
        [unknownSchemaId],
      )
    })

    it('reverts when the sender does not own the issuer DID', async function () {
      const { viem, credentialDefinitionRegistry, indyDidRegistry, trustee2, issuerId, schemaId } = fixture
      const otherIssuerId = `did:indy:besu:mainnet:${trustee2.account.address}`
      const otherDocument = toHex(stringToBytes(JSON.stringify({ id: otherIssuerId })))
      await indyDidRegistry.write.createDid([trustee2.account.address, otherDocument], {
        account: trustee2.account,
      })

      const { id, data } = credentialDefinitionData(issuerId, schemaId)
      await viem.assertions.revertWithCustomError(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [trustee2.account.address, id, issuerId, schemaId, data],
          { account: trustee2.account },
        ),
        credentialDefinitionRegistry,
        'NotIdentityOwner',
      )
    })

    it('reverts when the sender has no required role', async function () {
      const { viem, credentialDefinitionRegistry, roleControl, noRole, issuerAddress, issuerId, schemaId } =
        fixture
      const { id, data } = credentialDefinitionData(issuerId, schemaId)

      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [issuerAddress, id, issuerId, schemaId, data],
          { account: noRole.account },
        ),
        roleControl,
        'Unauthorized',
        [noRole.account.address],
      )
    })
  })

  describe('Credential Definitions with did:ethr issuers', function () {
    it('creates and resolves a Credential Definition', async function () {
      const { credentialDefinitionRegistry, trustee, schemaId } = fixture
      const ethrIssuerId = `did:ethr:${trustee.account.address}`
      const { id, data } = credentialDefinitionData(ethrIssuerId, schemaId)

      await credentialDefinitionRegistry.write.createCredentialDefinition(
        [trustee.account.address, id, ethrIssuerId, schemaId, data],
        { account: trustee.account },
      )
      const result = await credentialDefinitionRegistry.read.resolveCredentialDefinition([id])

      assert.equal(result.credDef, data)
    })

    it('reverts when the sender does not own the did:ethr issuer', async function () {
      const { viem, credentialDefinitionRegistry, trustee, trustee2, schemaId } = fixture
      const ethrIssuerId = `did:ethr:${trustee2.account.address}`
      const { id, data } = credentialDefinitionData(ethrIssuerId, schemaId)

      await viem.assertions.revertWithCustomError(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [trustee2.account.address, id, ethrIssuerId, schemaId, data],
          { account: trustee.account },
        ),
        credentialDefinitionRegistry,
        'NotIdentityOwner',
      )
    })

    it('reverts when the issuer DID is invalid', async function () {
      const { viem, credentialDefinitionRegistry, trustee, schemaId } = fixture
      const invalidIssuerId = 'did:ethr:ab$ddfgh354345'
      const { id, data } = credentialDefinitionData(invalidIssuerId, schemaId)

      await viem.assertions.revertWithCustomErrorWithArgs(
        credentialDefinitionRegistry.write.createCredentialDefinition(
          [trustee.account.address, id, invalidIssuerId, schemaId, data],
          { account: trustee.account },
        ),
        credentialDefinitionRegistry,
        'InvalidIssuerId',
        [invalidIssuerId],
      )
    })
  })

  describe('Endorsed Credential Definitions', function () {
    it('endorses and resolves a Credential Definition with did:ethr', async function () {
      const { credentialDefinitionRegistry, schemaRegistry, trustee } = fixture
      const issuerId = `did:ethr:${testActor.address}`
      const schema = schemaData('endorsed-ethr-schema')
      const schemaSignature = await signCreateSchema(
        schemaRegistry.address,
        testActor.address,
        schema.id,
        issuerId,
        schema.data,
      )
      await schemaRegistry.write.createSchemaSigned(
        [testActor.address, ...signatureArgs(schemaSignature), schema.id, issuerId, schema.data],
        { account: trustee.account },
      )

      const { id, data } = credentialDefinitionData(issuerId, schema.id)
      const signature = await signCreateCredentialDefinition(
        credentialDefinitionRegistry.address,
        testActor.address,
        id,
        issuerId,
        schema.id,
        data,
      )
      await credentialDefinitionRegistry.write.createCredentialDefinitionSigned(
        [testActor.address, ...signatureArgs(signature), id, issuerId, schema.id, data],
        { account: trustee.account },
      )

      const result = await credentialDefinitionRegistry.read.resolveCredentialDefinition([id])
      assert.equal(result.credDef, data)
    })

    it('endorses and resolves a Credential Definition with did:indy:besu', async function () {
      const { credentialDefinitionRegistry, schemaRegistry, indyDidRegistry, trustee } = fixture
      const issuerId = `did:indy:besu:${testActor.address}`
      const didDocument = toHex(stringToBytes(JSON.stringify({ id: issuerId })))
      const didSignature = await signCreateDid(indyDidRegistry.address, testActor.address, didDocument)
      await indyDidRegistry.write.createDidSigned(
        [testActor.address, ...signatureArgs(didSignature), didDocument],
        { account: trustee.account },
      )

      const schema = schemaData('endorsed-indybesu-schema')
      const schemaSignature = await signCreateSchema(
        schemaRegistry.address,
        testActor.address,
        schema.id,
        issuerId,
        schema.data,
      )
      await schemaRegistry.write.createSchemaSigned(
        [testActor.address, ...signatureArgs(schemaSignature), schema.id, issuerId, schema.data],
        { account: trustee.account },
      )

      const { id, data } = credentialDefinitionData(issuerId, schema.id)
      const signature = await signCreateCredentialDefinition(
        credentialDefinitionRegistry.address,
        testActor.address,
        id,
        issuerId,
        schema.id,
        data,
      )
      await credentialDefinitionRegistry.write.createCredentialDefinitionSigned(
        [testActor.address, ...signatureArgs(signature), id, issuerId, schema.id, data],
        { account: trustee.account },
      )

      const result = await credentialDefinitionRegistry.read.resolveCredentialDefinition([id])
      assert.equal(result.credDef, data)
    })

    it('reverts when the endorser signature does not match the issuer identity', async function () {
      const { viem, credentialDefinitionRegistry, schemaRegistry, trustee, trustee2 } = fixture
      const issuerId = `did:ethr:${testActor.address}`
      const schema = schemaData('wrong-identity-schema')
      const schemaSignature = await signCreateSchema(
        schemaRegistry.address,
        testActor.address,
        schema.id,
        issuerId,
        schema.data,
      )
      await schemaRegistry.write.createSchemaSigned(
        [testActor.address, ...signatureArgs(schemaSignature), schema.id, issuerId, schema.data],
        { account: trustee.account },
      )

      const { id, data } = credentialDefinitionData(issuerId, schema.id)
      const signature = await signCreateCredentialDefinition(
        credentialDefinitionRegistry.address,
        testActor.address,
        id,
        issuerId,
        schema.id,
        data,
      )
      await viem.assertions.revertWithCustomError(
        credentialDefinitionRegistry.write.createCredentialDefinitionSigned(
          [trustee2.account.address, ...signatureArgs(signature), id, issuerId, schema.id, data],
          { account: trustee2.account },
        ),
        credentialDefinitionRegistry,
        'NotIdentityOwner',
      )
    })

    it('reverts when the endorsement signature is invalid', async function () {
      const { viem, credentialDefinitionRegistry, schemaRegistry, trustee } = fixture
      const schema = schemaData('invalid-signature-schema')
      const schemaSignature = await signCreateSchema(
        schemaRegistry.address,
        testActor.address,
        schema.id,
        `did:ethr:${testActor.address}`,
        schema.data,
      )
      await schemaRegistry.write.createSchemaSigned(
        [
          testActor.address,
          ...signatureArgs(schemaSignature),
          schema.id,
          `did:ethr:${testActor.address}`,
          schema.data,
        ],
        { account: trustee.account },
      )

      const authorDid = `did:ethr:${testActor.address}`
      const { id, data } = credentialDefinitionData(authorDid, schema.id)
      const signature = await signCreateCredentialDefinition(
        credentialDefinitionRegistry.address,
        testActor.address,
        keccak256(stringToBytes('different-id')),
        authorDid,
        schema.id,
        data,
      )
      await viem.assertions.revertWithCustomError(
        credentialDefinitionRegistry.write.createCredentialDefinitionSigned(
          [testActor.address, ...signatureArgs(signature), id, authorDid, schema.id, data],
          { account: trustee.account },
        ),
        credentialDefinitionRegistry,
        'NotIdentityOwner',
      )
    })
  })
})
