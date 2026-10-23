/**
 * Copyright (c) 2024 DSR Corporation, Denver, Colorado.
 * https://www.dsr-corporation.com
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra'
import { existsSync, readdirSync } from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { padLeft, sha3 } from 'web3-utils'
import linker from 'solc/linker.js';

import { type UpgradeControlConfig } from './contracts/upgradeControl.js'
import { type AccountControlConfig } from './contracts/accountControl.js'
import { type CredentialDefinitionsConfig } from './contracts/credentialDefinitionRegistry.js'
import { type EthereumDidRegistryConfig } from './contracts/ethereumDidRegistry.js'
import { type IndyDidRegistryConfig } from './contracts/indyDidRegistry.js'
import { type LegacyMappingRegistryConfig } from './contracts/legacyMappingRegistry.js'
import { type RevocationRegistryConfig } from './contracts/revocationRegistry.js'
import { type RolesConfig } from './contracts/roleControl.js'
import { type SchemasConfig } from './contracts/schemaRegistry.js'
import { type UniversalDidResolverConfig } from './contracts/universalDidResolver.js'
import { type ValidatorsConfig } from './contracts/validatorControl.js'
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '../..')

export const slots = {
  '0': '0000000000000000000000000000000000000000000000000000000000000000',
  '1': '0000000000000000000000000000000000000000000000000000000000000001',
  '2': '0000000000000000000000000000000000000000000000000000000000000002',
  '3': '0000000000000000000000000000000000000000000000000000000000000003',
}

const proxyImplmentationSlot = '360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const initializableVersionSlot = 'f0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00'

export function computeContractAddress(name: string) {
  const bytecode = readContractBytecode(name)

  const bytecodeHash = sha3(bytecode)

  sha3(bytecode)?.substring(44)
}

export function buildProxySection(
  name: string,
  address: string,
  comment: string,
  storage: Record<string, string>,
  libraries?: { [libraryName: string]: string },
) {
  const proxyBytecode = readContractBytecode('ERC1967Proxy')
  let implementationBytecode = readContractBytecode(name)

  if (libraries) {
    implementationBytecode = linker.linkBytecode(implementationBytecode, libraries).split('\n')[0]
  }

  // set the version for the initializer to ensure that the initial version of the`initialize` method can not be called.
  storage[initializableVersionSlot] = `0x${padLeft('1', 64)}`

  // calculate and set contract implementation address
  const implementationAddress = sha3(implementationBytecode)!.substring(26)
  storage[proxyImplmentationSlot] = `0x${padLeft(implementationAddress, 64)}`

  return {
    [address]: {
      comment: `Proxy: ${comment}`,
      code: `0x${proxyBytecode}`,
      storage,
    },
    [`0x${implementationAddress}`]: {
      comment: `Implementation: ${comment}`,
      code: `0x${implementationBytecode}`,
    },
  }
}

export function buildSection(
  name: string,
  address: string,
  comment: string,
  storage: Record<string, string>,
  libraries?: { [libraryName: string]: string },
) {
  let bytecode = readContractBytecode(name)

  if (libraries) {
    bytecode = linker.linkBytecode(bytecode, libraries).split('\n')[0]
  }

  return {
    [address]: {
      comment,
      code: `0x${bytecode}`,
      storage,
    },
  }
}

export function readContractBytecode(contractName: string) {
  const artifactName = contractName === 'ERC1967Proxy' ? 'TestProxy' : contractName
  const artifactsDirectory = path.resolve(projectRoot, 'artifacts/contracts')
  if (!existsSync(artifactsDirectory)) {
    throw new Error('Hardhat artifacts not found. Compile the project first with "npx hardhat build".')
  }
  const artifactPath = findArtifact(artifactsDirectory, artifactName)
  if (artifactPath === undefined) {
    throw new Error(
      `Artifact for ${artifactName} not found. Compile the project first with "npx hardhat build".`,
    )
  }

  const artifact = fs.readJsonSync(artifactPath) as { deployedBytecode?: string }
  if (typeof artifact.deployedBytecode !== 'string' || artifact.deployedBytecode.length === 0) {
    throw new Error(`Artifact ${artifactPath} does not contain deployed bytecode.`)
  }
  return artifact.deployedBytecode.slice(2)
}

function findArtifact(directory: string, contractName: string): string | undefined {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const found = findArtifact(entryPath, contractName)
      if (found !== undefined) return found
    } else if (entry.isFile() && entry.name === `${contractName}.json`) {
      return entryPath
    }
  }
  return undefined
}

export interface ContractsConfigs {
  accountControl: AccountControlConfig
  credentialDefinitionRegistry: CredentialDefinitionsConfig
  indyDidRegistry: IndyDidRegistryConfig
  ethereumDidRegistry: EthereumDidRegistryConfig
  roleControl: RolesConfig
  schemaRegistry: SchemasConfig
  universalDidResolver: UniversalDidResolverConfig
  upgradeControl: UpgradeControlConfig
  validatorControl: ValidatorsConfig
  legacyMapping: LegacyMappingRegistryConfig
  revocationRegistry: RevocationRegistryConfig
}

export function prepareConfig(
  accounts: Array<{ account: string; role: number }>,
  validators: Array<{ account: string; validator: string }>,
): ContractsConfigs {
  const contracts: ContractsConfigs = fs.readJsonSync(path.resolve(projectRoot, 'references.json'))

  return {
    accountControl: {
      name: 'AccountControl',
      address: contracts.accountControl.address,
      description: 'Account permissioning smart contract',
      data: {
        roleControlContractAddress: contracts.roleControl.address,
        upgradeControlAddress: contracts.upgradeControl.address,
      },
    },
    credentialDefinitionRegistry: {
      name: 'CredentialDefinitionRegistry',
      address: contracts.credentialDefinitionRegistry.address,
      description: 'Smart contract to manage credential definitions',
      data: {
        universalDidResolverAddress: contracts.universalDidResolver.address,
        schemaRegistryAddress: contracts.schemaRegistry.address,
        upgradeControlAddress: contracts.upgradeControl.address,
        roleControlContractAddress: contracts.roleControl.address,
      },
    },
    indyDidRegistry: {
      name: 'IndyDidRegistry',
      address: contracts.indyDidRegistry.address,
      description: 'Smart contract to manage DIDs',
      data: {
        upgradeControlAddress: contracts.upgradeControl.address,
        roleControlContractAddress: contracts.roleControl.address,
      },
    },
    universalDidResolver: {
      name: 'UniversalDidResolver',
      address: contracts.universalDidResolver.address,
      description: 'Smart contract to resolve DIDs from various DID registries',
      data: {
        indyDidRegistryAddress: contracts.indyDidRegistry.address,
        ethrDidRegistryAddress: contracts.ethereumDidRegistry.address,
        upgradeControlAddress: contracts.upgradeControl.address,
      },
    },
    ethereumDidRegistry: {
      name: 'EthereumExtDidRegistry',
      address: contracts.ethereumDidRegistry.address,
      description: 'Ethereum registry for ERC-1056 ethr did methods',
      data: {
        upgradeControlAddress: contracts.upgradeControl.address,
      },
    },
    roleControl: {
      name: 'RoleControl',
      address: contracts.roleControl.address,
      description: 'Smart contract to manage account roles',
      data: {
        accounts,
        roleOwners: {
          '1': '1',
          '2': '1',
          '3': '1',
        },
        upgradeControlAddress: contracts.upgradeControl.address,
      },
    },
    schemaRegistry: {
      name: 'SchemaRegistry',
      address: contracts.schemaRegistry.address,
      description: 'Smart contract to manage schemas',
      data: {
        universalDidResolverAddress: contracts.universalDidResolver.address,
        upgradeControlAddress: contracts.upgradeControl.address,
        roleControlContractAddress: contracts.roleControl.address,
      },
    },
    upgradeControl: {
      name: 'UpgradeControl',
      address: contracts.upgradeControl.address,
      description: 'Smart contract to manage proxy contract upgrades',
      data: {
        roleControlContractAddress: contracts.roleControl.address,
      },
    },
    validatorControl: {
      name: 'ValidatorControl',
      address: contracts.validatorControl.address,
      description: 'Smart contract to manage validator nodes',
      data: {
        validators,
        roleControlContractAddress: contracts.roleControl.address,
        upgradeControlAddress: contracts.upgradeControl.address,
      },
    },
    legacyMapping: {
      name: 'LegacyMappingRegistry',
      address: contracts.legacyMapping.address,
      description: 'Smart contract to store mapping of legacy identifiers to new one',
      data: {
        universalDidResolver: contracts.universalDidResolver.address,
        upgradeControlAddress: contracts.upgradeControl.address,
        roleControlContractAddress: contracts.roleControl.address,
      },
    },
    revocationRegistry: {
      name: 'RevocationRegistry',
      address: contracts.revocationRegistry.address,
      description: 'Smart contract to manage revocations',
      data: {
        universalDidResolverAddress: contracts.universalDidResolver.address,
        credentialDefinitionRegistryAddress: contracts.credentialDefinitionRegistry.address,
        upgradeControlAddress: contracts.upgradeControl.address,
        roleControlContractAddress: contracts.roleControl.address,
      },
    },
  }
}
