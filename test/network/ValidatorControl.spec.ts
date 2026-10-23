import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { network } from 'hardhat'
import { deployRoleControl, ZERO_ADDRESS } from '../utils/viem-helpers.js'

async function deployFixture(viem: Awaited<ReturnType<typeof network.create>>['viem']) {
  const roleFixture = await deployRoleControl(viem)
  const { accounts, roleControl } = roleFixture
  const initialValidators = [
    { validator: accounts.endorser.account.address, account: accounts.steward.account.address },
    { validator: accounts.endorser2.account.address, account: accounts.steward2.account.address },
  ] as const
  const validatorControl = await viem.deployContract('ValidatorControl')
  await validatorControl.write.initialize([roleControl.address, ZERO_ADDRESS, initialValidators])
  return { ...roleFixture, validatorControl, initialValidators }
}

describe('ValidatorControl', async function () {
  const { viem } = await network.create()
  let fixture: Awaited<ReturnType<typeof deployFixture>>

  beforeEach(async function () {
    fixture = await deployFixture(viem)
  })

  it('returns the current validators', async function () {
    const validators = await fixture.validatorControl.read.getValidators()
    assert.deepEqual(
      validators.map((validator) => validator.toLowerCase()).sort(),
      fixture.initialValidators.map(({ validator }) => validator.toLowerCase()).sort(),
    )
  })

  it('allows a steward to add and remove a validator', async function () {
    const { validatorControl, accounts } = fixture
    const newValidator = accounts.noRole.account.address
    await validatorControl.write.addValidator([newValidator], { account: accounts.steward3.account })
    assert.ok(
      (await validatorControl.read.getValidators()).some(
        (validator) => validator.toLowerCase() === newValidator.toLowerCase(),
      ),
    )
    await validatorControl.write.removeValidator([newValidator], { account: accounts.steward3.account })
    assert.ok(
      !(await validatorControl.read.getValidators()).some(
        (validator) => validator.toLowerCase() === newValidator.toLowerCase(),
      ),
    )
  })

  it('rejects additions from accounts without the steward role', async function () {
    const { viem, validatorControl, roleControl, accounts } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      validatorControl.write.addValidator([accounts.noRole.account.address], {
        account: accounts.noRole.account,
      }),
      roleControl,
      'Unauthorized',
      [accounts.noRole.account.address],
    )
  })

  it('rejects zero and duplicate validator addresses', async function () {
    const { viem, validatorControl, accounts, initialValidators } = fixture
    await viem.assertions.revertWithCustomError(
      validatorControl.write.addValidator([ZERO_ADDRESS], { account: accounts.steward3.account }),
      validatorControl,
      'InvalidValidatorAddress',
    )
    await viem.assertions.revertWithCustomErrorWithArgs(
      validatorControl.write.addValidator([initialValidators[0].validator], {
        account: accounts.steward3.account,
      }),
      validatorControl,
      'ValidatorAlreadyExists',
      [initialValidators[0].validator],
    )
  })

  it('rejects a steward with an active validator and removal of the last validator', async function () {
    const { viem, validatorControl, accounts, initialValidators } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      validatorControl.write.addValidator([accounts.noRole.account.address], {
        account: accounts.steward.account,
      }),
      validatorControl,
      'SenderHasActiveValidator',
      [accounts.steward.account.address],
    )

    await validatorControl.write.removeValidator([initialValidators[1].validator], {
      account: accounts.steward2.account,
    })
    await viem.assertions.revertWithCustomError(
      validatorControl.write.removeValidator([initialValidators[0].validator], {
        account: accounts.steward.account,
      }),
      validatorControl,
      'CannotDeactivateLastValidator',
    )
  })

  it('rejects removal of unknown validators', async function () {
    const { viem, validatorControl, accounts } = fixture
    await viem.assertions.revertWithCustomErrorWithArgs(
      validatorControl.write.removeValidator([accounts.noRole.account.address], {
        account: accounts.steward.account,
      }),
      validatorControl,
      'ValidatorNotFound',
      [accounts.noRole.account.address],
    )
  })
})
