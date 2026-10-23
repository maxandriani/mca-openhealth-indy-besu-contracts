import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import { encodeFunctionData } from 'viem'
import { deployRoleControl } from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const roles = await deployRoleControl(viem)
  const upgradeControl = await viem.deployContract('UpgradeControl')
  await upgradeControl.write.initialize([roles.roleControl.address])
  const implementationV1 = await viem.deployContract('UpgradablePrototypeV1')
  const implementationV2 = await viem.deployContract('UpgradablePrototypeV2')
  const initData = encodeFunctionData({
    abi: implementationV1.abi,
    functionName: 'initialize',
    args: [upgradeControl.address],
  })
  const proxy = await viem.deployContract('TestProxy', [implementationV1.address, initData])
  const upgradable = await viem.getContractAt('UpgradablePrototypeV1', proxy.address)
  return { ...roles, upgradeControl, implementationV1, implementationV2, proxy, upgradable }
}

describe('UpgradeControl', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('upgrades a proposed contract after sufficient trustee approvals', async function () {
    const { upgradeControl, upgradable, implementationV2, accounts } = fixture
    const proxyAddress = upgradable.address
    const implementationAddress = implementationV2.address
    await upgradeControl.write.propose([proxyAddress, implementationAddress], {
      account: accounts.trustee.account,
    })
    for (const trustee of [accounts.trustee.account, accounts.trustee2.account, accounts.trustee3.account]) {
      await upgradeControl.write.approve([proxyAddress, implementationAddress], { account: trustee })
    }
    await upgradeControl.read.ensureSufficientApprovals([proxyAddress, implementationAddress])
    assert.equal(await upgradable.read.getVersion(), '2.0')
  })

  it('rejects proposals from non-trustees', async function () {
    const { viem, upgradeControl, upgradable, implementationV2, roleControl, accounts } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      upgradeControl.write.propose([upgradable.address, implementationV2.address], {
        account: accounts.endorser.account,
      }),
      roleControl,
      'Unauthorized',
      [accounts.endorser.account.address],
    )
  })

  it('rejects non-UUPS implementations', async function () {
    const { viem, upgradeControl, upgradable, accounts } = fixture
    const notUpgradable = await viem.deployContract('NotUpgradable')
    await viem.assertions.revertWithCustomErrorWithArgs(
      upgradeControl.write.propose([upgradable.address, notUpgradable.address], {
        account: accounts.trustee.account,
      }),
      upgradeControl,
      'ERC1967InvalidImplementation',
      [notUpgradable.address],
    )
  })

  it('requires a proposal and rejects duplicate proposals and approvals', async function () {
    const { viem, upgradeControl, upgradable, implementationV2, accounts } = fixture
    const proposal = [upgradable.address, implementationV2.address] as const
    await viem.assertions.revertWithCustomErrorWithArgs(
      upgradeControl.write.approve(proposal, { account: accounts.trustee.account }),
      upgradeControl,
      'UpgradeProposalNotFound',
      [...proposal],
    )
    await upgradeControl.write.propose(proposal, { account: accounts.trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      upgradeControl.write.propose(proposal, { account: accounts.trustee2.account }),
      upgradeControl,
      'UpgradeAlreadyProposed',
      [...proposal],
    )
    await upgradeControl.write.approve(proposal, { account: accounts.trustee.account })
    await viem.assertions.revertWithCustomErrorWithArgs(
      upgradeControl.write.approve(proposal, { account: accounts.trustee.account }),
      upgradeControl,
      'UpgradeAlreadyApproved',
      [...proposal],
    )
  })

  it('rejects completion before the required number of approvals', async function () {
    const { viem, upgradeControl, upgradable, implementationV2, accounts } = fixture
    const proposal = [upgradable.address, implementationV2.address] as const
    await upgradeControl.write.propose(proposal, { account: accounts.trustee.account })
    await upgradeControl.write.approve(proposal, { account: accounts.trustee.account })
    await viem.assertions.revertWithCustomError(
      upgradeControl.read.ensureSufficientApprovals(proposal),
      upgradeControl,
      'InsufficientApprovals',
    )
    assert.equal(await upgradable.read.getVersion(), '1.0')
  })
})
