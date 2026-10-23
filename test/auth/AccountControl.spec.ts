import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import { deployRoleControl, ZERO_ADDRESS } from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const roleFixture = await deployRoleControl(viem)
  const accountControl = await viem.deployContract('AccountControl')
  await accountControl.write.initialize([roleFixture.roleControl.address, ZERO_ADDRESS])
  return { ...roleFixture, accountControl }
}

describe('AccountControl', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('allows write transactions from all assigned roles and unassigned accounts', async function () {
    const { accountControl, accounts } = fixture
    for (const account of [
      accounts.trustee,
      accounts.endorser,
      accounts.steward,
      accounts.noRole,
    ]) {
      assert.equal(
        await accountControl.read.transactionAllowed([
          account.account.address,
          '0x0000000000000000000000000000000000003333',
          0n,
          0n,
          0n,
          '0x00',
        ]),
        true,
      )
    }
  })

  it('allows contract deployment only from trustees', async function () {
    const { accountControl, accounts } = fixture
    const isAllowed = (sender: `0x${string}`) =>
      accountControl.read.transactionAllowed([sender, ZERO_ADDRESS, 0n, 0n, 0n, '0x00'])

    assert.equal(await isAllowed(accounts.trustee.account.address), true)
    assert.equal(await isAllowed(accounts.endorser.account.address), false)
    assert.equal(await isAllowed(accounts.steward.account.address), false)
    assert.equal(await isAllowed(accounts.noRole.account.address), false)
  })
})
