import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import {
  deployDidStack,
  makeDidDocument,
  signEndorsement,
  signatureArgs,
  testActor,
} from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const didStack = await deployDidStack(viem)
  const { trustee } = didStack.accounts
  const identity = trustee.account.address
  const did = `did:indy:besu:testnet:${identity}`
  const document = makeDidDocument(did)
  await didStack.indyDidRegistry.write.createDid([identity, document], {
    account: trustee.account,
  })
  return { ...didStack, trustee, identity, did, document }
}

describe('UniversalDidResolver', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('resolves Indy Besu DID documents and metadata', async function () {
    const { universalDidResolver, did, document, identity } = fixture
    assert.equal(await universalDidResolver.read.resolveDocument([did]), document)
    const metadata = await universalDidResolver.read.resolveMetadata([did])
    assert.equal(metadata.owner.toLowerCase(), identity.toLowerCase())
    assert.equal(metadata.deactivated, false)
  })

  it('resolves Ethereum DID metadata', async function () {
    const { universalDidResolver, identity } = fixture
    const metadata = await universalDidResolver.read.resolveMetadata([`did:ethr:${identity}`])
    assert.equal(metadata.owner.toLowerCase(), identity.toLowerCase())
    assert.equal(metadata.deactivated, false)
  })

  it('resolves Ethereum DID metadata from a public key identifier', async function () {
    const { universalDidResolver } = fixture
    const metadata = await universalDidResolver.read.resolveMetadata([`did:ethr:testnet:${testActor.publicKey}`])
    assert.equal(metadata.owner.toLowerCase(), testActor.address.toLowerCase())
    assert.equal(metadata.deactivated, false)
  })

  it('resolves Indy Besu DID documents and metadata from a public key identifier', async function () {
    const { indyDidRegistry, universalDidResolver, trustee } = fixture
    const did = `did:indy:besu:testnet:${testActor.publicKey}`
    const document = makeDidDocument(did)
    const signature = await signEndorsement(
      indyDidRegistry.address,
      testActor.address,
      'createDid',
      ['bytes'],
      [document],
    )

    await indyDidRegistry.write.createDidSigned(
      [testActor.address, ...signatureArgs(signature), document],
      { account: trustee.account },
    )

    assert.equal(await universalDidResolver.read.resolveDocument([did]), document)
    const metadata = await universalDidResolver.read.resolveMetadata([did])
    assert.equal(metadata.owner.toLowerCase(), testActor.address.toLowerCase())
    assert.equal(metadata.deactivated, false)
  })

  it('rejects malformed DID identifiers', async function () {
    const { viem, universalDidResolver } = fixture
    const did = 'did:ethr:ab$ddfgh354345'
    await viem.assertions.revertWithCustomErrorWithArgs(
      universalDidResolver.read.resolveMetadata([did]),
      universalDidResolver,
      'IncorrectDid',
      [did],
    )

    const legacyIndyDid = `did:indybesu:${testActor.address}`
    await viem.assertions.revertWithCustomErrorWithArgs(
      universalDidResolver.read.resolveMetadata([legacyIndyDid]),
      universalDidResolver,
      'IncorrectDid',
      [legacyIndyDid],
    )
  })
})
