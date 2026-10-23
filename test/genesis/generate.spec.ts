import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseArguments } from '../../scripts/genesis/generate.js'

const validator = '0x93917cadbace5dfce132b991732c6cda9bcc5b8a'
const validatorAccount = '0xed9d02e382b34818e88b88a309c7fe71e65f419d'
const secondValidator = '0x27a97c9aaf04f18f3014c32e036dd0ac76da5f18'
const secondValidatorAccount = '0xb30f304642de3fee4365ed5cd06ea2e69d3fd0ca'

describe('genesis CLI arguments', function () {
  it('accepts repeatable validator and role account options', function () {
    const options = parseArguments([
      '--validator',
      `${validator}:${validatorAccount}`,
      '--validator',
      `${secondValidator}:${secondValidatorAccount}`,
      '--account',
      '0x0000000000000000000000000000000000000001:Endorser',
      '--account',
      '0x0000000000000000000000000000000000000002:Steward',
      '--output',
      'genesis.json',
    ])

    assert.notEqual(options, 'help')
    if (options === 'help') return
    assert.deepEqual(options.validators, [
      { validator, account: validatorAccount },
      { validator: secondValidator, account: secondValidatorAccount },
    ])
    assert.deepEqual(options.accounts, [
      { account: validatorAccount, role: 1 },
      { account: secondValidatorAccount, role: 1 },
      { account: '0x0000000000000000000000000000000000000001', role: 2 },
      { account: '0x0000000000000000000000000000000000000002', role: 3 },
    ])
    assert.equal(options.output, 'genesis.json')
  })

  it('rejects an account already associated with a validator', function () {
    assert.throws(
      () =>
        parseArguments([
          '--validator',
          `${validator}:${validatorAccount}`,
          '--account',
          `${validatorAccount}:Endorser`,
          '--output',
          'genesis.json',
        ]),
      /associated with a validator/,
    )
  })

  it('rejects duplicate validators, duplicate accounts, and unknown roles', function () {
    assert.throws(
      () =>
        parseArguments([
          '--validator',
          `${validator}:${validatorAccount}`,
          '--validator',
          `${validator}:${secondValidatorAccount}`,
          '--output',
          'genesis.json',
        ]),
      /Duplicate validator address/,
    )
    assert.throws(
      () =>
        parseArguments([
          '--validator',
          `${validator}:${validatorAccount}`,
          '--account',
          '0x0000000000000000000000000000000000000001:Steward',
          '--account',
          '0x0000000000000000000000000000000000000001:Trustee',
          '--output',
          'genesis.json',
        ]),
      /Duplicate --account address/,
    )
    assert.throws(
      () =>
        parseArguments([
          '--validator',
          `${validator}:${validatorAccount}`,
          '--account',
          '0x0000000000000000000000000000000000000001:Admin',
          '--output',
          'genesis.json',
        ]),
      /Invalid role/,
    )
  })
})
