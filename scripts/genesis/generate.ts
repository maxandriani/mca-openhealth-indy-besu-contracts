#!/usr/bin/env -S tsx
/**
 * Copyright (c) 2024 DSR Corporation, Denver, Colorado.
 * https://www.dsr-corporation.com
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAddress } from 'viem'
import { accountControl } from './contracts/accountControl.js'
import { credentialDefinitionRegistry } from './contracts/credentialDefinitionRegistry.js'
import { ethereumDidRegistry } from './contracts/ethereumDidRegistry.js'
import { indyDidRegistry } from './contracts/indyDidRegistry.js'
import { legacyMappingRegistry } from './contracts/legacyMappingRegistry.js'
import { revocationRegistry } from './contracts/revocationRegistry.js'
import { roleControl } from './contracts/roleControl.js'
import { schemaRegistry } from './contracts/schemaRegistry.js'
import { universalDidResolver } from './contracts/universalDidResolver.js'
import { upgradeControl } from './contracts/upgradeControl.js'
import { validatorControl } from './contracts/validatorControl.js'
import { prepareConfig } from './helpers.js'

type RoleName = 'Trustee' | 'Endorser' | 'Steward'
type RoleAccount = { account: string; role: number }
type Validator = { account: string; validator: string }

const ROLE_IDS: Record<RoleName, number> = {
  Trustee: 1,
  Endorser: 2,
  Steward: 3,
}

const HELP = `Usage:
  indy-besu-generate-genesis --output <file.json> [--validator <address>:<account>]... [--account <address>:<role>]...

Options:
  --validator <address>:<account>  Add a validator and map it to its account (repeatable)
  --account <address>:<role>       Add an account with role Trustee, Endorser, or Steward (repeatable)
  --output <file.json>             Write the generated genesis JSON to this path
  --help                           Show this help

Accounts associated with validators are automatically added as trustees. Do not also pass
those accounts (or validator addresses) with --account.`

interface CliOptions {
  output: string
  validators: Validator[]
  accounts: RoleAccount[]
}

function parsePair(value: string, optionName: string): [string, string] {
  const parts = value.split(':')
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) {
    throw new Error(`${optionName} expects <address>:<${optionName === '--validator' ? 'account' : 'role'}>.`)
  }

  const [first, second] = parts.map((part) => part.trim())
  if (!isAddress(first, { strict: false })) {
    throw new Error(`Invalid address "${first}" passed to ${optionName}.`)
  }

  return [first.toLowerCase(), second]
}

export function parseArguments(args: string[]): CliOptions | 'help' {
  const validators: Validator[] = []
  const explicitAccounts: RoleAccount[] = []
  let output: string | undefined

  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (option === '--help' || option === '-h') return 'help'
    if (option !== '--validator' && option !== '--account' && option !== '--output') {
      throw new Error(`Unknown option "${option}".\n\n${HELP}`)
    }

    const value = args[++index]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${option}.`)
    }

    if (option === '--validator') {
      const [validator, account] = parsePair(value, option)
      if (!isAddress(account, { strict: false })) {
        throw new Error(`Invalid validator account address "${account}".`)
      }
      validators.push({ validator, account: account.toLowerCase() })
    } else if (option === '--account') {
      const [account, role] = parsePair(value, option)
      if (!Object.hasOwn(ROLE_IDS, role)) {
        throw new Error(`Invalid role "${role}". Expected Trustee, Endorser, or Steward.`)
      }
      explicitAccounts.push({ account, role: ROLE_IDS[role as RoleName] })
    } else {
      if (output !== undefined) throw new Error('--output may only be specified once.')
      output = value
    }
  }

  if (output === undefined) throw new Error('Missing required --output <file.json>.\n\n' + HELP)
  if (validators.length === 0) throw new Error('At least one --validator is required.')

  const validatorAddresses = new Set<string>()
  const validatorAccounts = new Set<string>()
  for (const { validator, account } of validators) {
    if (validatorAddresses.has(validator)) throw new Error(`Duplicate validator address "${validator}".`)
    if (validatorAccounts.has(account)) throw new Error(`Duplicate validator account "${account}".`)
    if (validator === account) throw new Error(`Validator address and account must be different ("${validator}").`)
    validatorAddresses.add(validator)
    validatorAccounts.add(account)
  }

  const assignedAddresses = new Set<string>()
  for (const { account } of explicitAccounts) {
    if (validatorAddresses.has(account) || validatorAccounts.has(account)) {
      throw new Error(`Account "${account}" is associated with a validator and cannot be passed with --account.`)
    }
    if (assignedAddresses.has(account)) throw new Error(`Duplicate --account address "${account}".`)
    assignedAddresses.add(account)
  }

  const accounts = [
    ...validators.map(({ account }) => ({ account, role: ROLE_IDS.Trustee })),
    ...explicitAccounts,
  ]
  return { output, validators, accounts }
}

export function generateGenesis(accounts: RoleAccount[], validators: Validator[]) {
  const config = prepareConfig(accounts, validators)
  return {
    ...accountControl(config.accountControl),
    ...roleControl(config.roleControl),
    ...validatorControl(config.validatorControl),
    ...upgradeControl(config.upgradeControl),
    ...indyDidRegistry(config.indyDidRegistry),
    ...ethereumDidRegistry(config.ethereumDidRegistry),
    ...universalDidResolver(config.universalDidResolver),
    ...schemaRegistry(config.schemaRegistry),
    ...credentialDefinitionRegistry(config.credentialDefinitionRegistry),
    ...legacyMappingRegistry(config.legacyMapping),
    ...revocationRegistry(config.revocationRegistry),
  }
}

export function main(args = process.argv.slice(2)) {
  const options = parseArguments(args)
  if (options === 'help') {
    console.log(HELP)
    return
  }

  const outputPath = path.resolve(process.cwd(), options.output)
  const genesis = generateGenesis(options.accounts, options.validators)
  writeFileSync(outputPath, `${JSON.stringify(genesis, null, 2)}\n`, 'utf8')
  console.log(`Genesis JSON written to ${outputPath}`)
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    main()
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
