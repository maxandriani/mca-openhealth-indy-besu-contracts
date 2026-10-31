import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import {
  deployDidStack,
  makeDidDocument,
  signEndorsement,
} from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const didStack = await deployDidStack(viem)
  const { trustee, trustee2, trustee3, noRole } = didStack.accounts
  const identity = trustee.account.address
  const did = `did:indy:besu:testnet:${identity}`
  return { ...didStack, trustee, trustee2, trustee3, noRole, identity, did, document: makeDidDocument(did) }
}

describe('IndyDidRegistry', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('creates and resolves a DID document', async function () {
    const { indyDidRegistry, trustee, identity, document } = fixture
    await indyDidRegistry.write.createDid([identity, document], { account: trustee.account })
    const record = await indyDidRegistry.read.resolveDid([identity])
    assert.equal(record.document, document)
    assert.equal(record.metadata.owner.toLowerCase(), identity.toLowerCase())
  })

  it('rejects resolving a missing DID and creating a duplicate DID', async function () {
    const { viem, indyDidRegistry, trustee, identity, document } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.read.resolveDid([identity]),
      indyDidRegistry,
      'DidNotFound',
      [identity],
    )
    await indyDidRegistry.write.createDid([identity, document], { account: trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.write.createDid([identity, document], { account: trustee.account }),
      indyDidRegistry,
      'DidAlreadyExist',
      [identity],
    )
  })

  it('requires a role to create DID records', async function () {
    const { viem, indyDidRegistry, roleControl, noRole } = fixture
    const document = makeDidDocument(`did:indy:besu:${noRole.account.address}`)
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.write.createDid([noRole.account.address, document], {
        account: noRole.account,
      }),
      roleControl,
      'Unauthorized',
      [noRole.account.address],
    )
  })

  it('allows the identity owner to update and deactivate after their role is revoked', async function () {
    const { indyDidRegistry, roleControl, trustee, trustee3 } = fixture
    const identity = trustee3.account.address
    const did = `did:indy:besu:testnet:${identity}`
    await indyDidRegistry.write.createDid([identity, makeDidDocument(did)], { account: trustee3.account })
    await roleControl.write.revokeRole([1, identity], { account: trustee.account })

    const updatedDocument = makeDidDocument(did, {
      id: `${did}#key-1`,
      type: 'Ed25519VerificationKey2018',
      controller: did,
      publicKeyMultibase: 'key',
    })
    await indyDidRegistry.write.updateDid([identity, updatedDocument], { account: trustee3.account })
    assert.equal((await indyDidRegistry.read.resolveDid([identity])).document, updatedDocument)

    await indyDidRegistry.write.deactivateDid([identity], { account: trustee3.account })
    assert.equal((await indyDidRegistry.read.resolveDid([identity])).metadata.deactivated, true)
  })

  it('allows the owner to update their DID document', async function () {
    const { indyDidRegistry, trustee, identity, document } = fixture
    await indyDidRegistry.write.createDid([identity, document], { account: trustee.account })
    const updatedDocument = makeDidDocument('did:indy:besu:updated')
    await indyDidRegistry.write.updateDid([identity, updatedDocument], { account: trustee.account })
    assert.equal((await indyDidRegistry.read.resolveDid([identity])).document, updatedDocument)
  })

  it('rejects updates from a different identity and updates to a deactivated DID', async function () {
    const { viem, indyDidRegistry, trustee, trustee2, identity, document } = fixture
    await indyDidRegistry.write.createDid([identity, document], { account: trustee.account })
    await viem.assertions.revertWithCustomError(
      indyDidRegistry.write.updateDid([identity, document], { account: trustee2.account }),
      indyDidRegistry,
      'NotIdentityOwner',
    )
    await indyDidRegistry.write.deactivateDid([identity], { account: trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.write.updateDid([identity, document], { account: trustee.account }),
      indyDidRegistry,
      'DidHasBeenDeactivated',
      [identity],
    )
  })

  it('rejects updating or deactivating a missing DID', async function () {
    const { viem, indyDidRegistry, trustee, identity, document } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.write.updateDid([identity, document], { account: trustee.account }),
      indyDidRegistry,
      'DidNotFound',
      [identity],
    )
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.write.deactivateDid([identity], { account: trustee.account }),
      indyDidRegistry,
      'DidNotFound',
      [identity],
    )
  })

  it('rejects duplicate deactivation and deactivation from a different identity', async function () {
    const { viem, indyDidRegistry, trustee, trustee2, identity, document } = fixture
    await indyDidRegistry.write.createDid([identity, document], { account: trustee.account })
    await viem.assertions.revertWithCustomError(
      indyDidRegistry.write.deactivateDid([identity], { account: trustee2.account }),
      indyDidRegistry,
      'NotIdentityOwner',
    )
    await indyDidRegistry.write.deactivateDid([identity], { account: trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      indyDidRegistry.write.deactivateDid([identity], { account: trustee.account }),
      indyDidRegistry,
      'DidHasBeenDeactivated',
      [identity],
    )
  })

  it('creates a DID from an off-chain identity signature', async function () {
    const { indyDidRegistry, trustee, identity } = fixture
    const signedIdentity = '0x2036C6CD85692F0Fb2C26E6c6B2ECed9e4478Dfd'
    const did = `did:indy:besu:testnet:${signedIdentity}`
    const document = makeDidDocument(did)
    const signature = await signEndorsement(
      indyDidRegistry.address,
      signedIdentity,
      'createDid',
      ['bytes'],
      [document],
    )
    await indyDidRegistry.write.createDidSigned(
      [signedIdentity, ...[Number(signature.v), signature.r, signature.s] as const, document],
      { account: trustee.account },
    )
    assert.equal((await indyDidRegistry.read.resolveDid([signedIdentity])).document, document)
    assert.notEqual(identity, signedIdentity)
  })
})
