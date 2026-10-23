import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import { deployRoleControl } from '../utils/viem-helpers.js'

describe('RoleControl', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployRoleControl>>

  beforeEach(async function () {
    fixture = await deployRoleControl(viem)
  })

  it('reports the initialized trustee, assigned roles, and empty roles correctly', async function () {
    const { roleControl, accounts } = fixture
    assert.equal(await roleControl.read.hasRole([1, accounts.deployer.account.address]), true)
    assert.equal(await roleControl.read.hasRole([1, accounts.trustee.account.address]), true)
    assert.equal(await roleControl.read.hasRole([2, accounts.endorser.account.address]), true)
    assert.equal(await roleControl.read.hasRole([3, accounts.steward.account.address]), true)
    assert.equal(await roleControl.read.hasRole([1, accounts.noRole.account.address]), false)
  })

  it('allows trustees to assign and replace roles', async function () {
    const { roleControl, accounts } = fixture
    await roleControl.write.assignRole([2, accounts.noRole.account.address], {
      account: accounts.trustee.account,
    })
    assert.equal(await roleControl.read.hasRole([2, accounts.noRole.account.address]), true)

    await roleControl.write.assignRole([3, accounts.noRole.account.address], {
      account: accounts.trustee.account,
    })
    assert.equal(await roleControl.read.hasRole([3, accounts.noRole.account.address]), true)
    assert.equal(await roleControl.read.hasRole([2, accounts.noRole.account.address]), false)
  })

  it('rejects role assignment from an account without a role', async function () {
    const { viem, roleControl, accounts } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      roleControl.write.assignRole([2, accounts.noRole.account.address], {
        account: accounts.noRole.account,
      }),
      roleControl,
      'Unauthorized',
      [accounts.noRole.account.address],
    )
  })

  it('allows trustees to revoke roles and rejects unauthorized revocation', async function () {
    const { viem, roleControl, accounts } = fixture
    await roleControl.write.revokeRole([2, accounts.endorser.account.address], {
      account: accounts.trustee.account,
    })
    assert.equal(await roleControl.read.hasRole([2, accounts.endorser.account.address]), false)

    await viem.assertions.revertWithCustomErrorWithArgs(
      roleControl.write.revokeRole([2, accounts.endorser2.account.address], {
        account: accounts.noRole.account,
      }),
      roleControl,
      'Unauthorized',
      [accounts.noRole.account.address],
    )
  })

  it('returns the count of accounts assigned to each role', async function () {
    const { roleControl, accounts } = fixture
    await roleControl.write.assignRole([1, accounts.noRole.account.address], {
      account: accounts.trustee.account,
    })
    assert.equal(await roleControl.read.getRoleCount([1]), 5)
    assert.equal(await roleControl.read.getRoleCount([2]), 3)
    assert.equal(await roleControl.read.getRoleCount([3]), 3)
  })
})
