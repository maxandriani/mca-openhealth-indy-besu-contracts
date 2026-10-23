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

export type Viem = Awaited<ReturnType<typeof network.create>>['viem']

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const testActor = privateKeyToAccount(
  '0xa285ab66393c5fdda46d6fbad9e27fafd438254ab72ad5acb681a0e9f20f5d7b',
)

export function bytes(value: string): Hex {
  return toHex(stringToBytes(value))
}

export function makeDidDocument(did: string, verificationMethod?: object): Hex {
  return bytes(
    JSON.stringify({
      '@context': 'https://www.w3.org/ns/did/v1',
      id: did,
      ...(verificationMethod ? { verificationMethod: [verificationMethod] } : {}),
    }),
  )
}

export function schemaData(issuerId: string, name = 'test') {
  const id = keccak256(stringToBytes(`${issuerId}/anoncreds/v0/SCHEMA/${name}/1.0.0`))
  const data = bytes(JSON.stringify({ name, version: '1.0.0', attrNames: ['name'] }))
  return { id, data }
}

export function credentialDefinitionData(issuerId: string, schemaId: Hex, name = 'test') {
  const id = keccak256(stringToBytes(`${issuerId}/anoncreds/v0/CLAIM_DEF/${name}/1.0.0`))
  const data = bytes(JSON.stringify({ id: name, schemaId, type: 'CL' }))
  return { id, data }
}

export function revocationDefinitionData(issuerId: string, credDefId: Hex, name = 'test') {
  const id = keccak256(stringToBytes(`${issuerId}/anoncreds/v0/REV_REG_DEF/${name}/1.0.0`))
  const data = bytes(JSON.stringify({ id: name, credDefId, type: 'CL_ACCUM' }))
  return { id, data }
}

export function signatureArgs(signature: ReturnType<typeof parseSignature>) {
  return [Number(signature.v), signature.r, signature.s] as const
}

export async function signEndorsement(
  contractAddress: Address,
  identity: Address,
  method: string,
  types: readonly string[],
  values: readonly (string | number | bigint | boolean | Address | Hex)[],
) {
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'bytes1', 'address', 'address', 'string', ...types],
      ['0x19', '0x00', contractAddress, identity, method, ...values],
    ),
  )
  return parseSignature(await testActor.sign({ hash }))
}

export async function deployRoleControl(viem: Viem) {
  const accounts = await viem.getWalletClients()
  const [deployer, trustee, trustee2, trustee3, endorser, endorser2, endorser3, steward, steward2, steward3, noRole] =
    accounts
  const roleControl = await viem.deployContract('RoleControl')
  await roleControl.write.initialize([ZERO_ADDRESS])

  for (const [role, account] of [
    [1, trustee],
    [1, trustee2],
    [1, trustee3],
    [2, endorser],
    [2, endorser2],
    [2, endorser3],
    [3, steward],
    [3, steward2],
    [3, steward3],
  ] as const) {
    await roleControl.write.assignRole([role, account.account.address], { account: deployer.account })
  }

  return {
    viem,
    accounts: { deployer, trustee, trustee2, trustee3, endorser, endorser2, endorser3, steward, steward2, steward3, noRole },
    roleControl,
  }
}

export async function deployDidStack(viem: Viem) {
  const { accounts, roleControl } = await deployRoleControl(viem)
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

  return { viem, accounts, roleControl, indyDidRegistry, ethereumDidRegistry, universalDidResolver }
}

export async function deploySchemaStack(viem: Viem) {
  const didStack = await deployDidStack(viem)
  const schemaRegistry = await viem.deployContract('SchemaRegistry')
  await schemaRegistry.write.initialize([
    ZERO_ADDRESS,
    didStack.universalDidResolver.address,
    didStack.roleControl.address,
  ])
  return { ...didStack, schemaRegistry }
}

export async function deployCredentialDefinitionStack(viem: Viem) {
  const schemaStack = await deploySchemaStack(viem)
  const credentialDefinitionRegistry = await viem.deployContract('CredentialDefinitionRegistry')
  await credentialDefinitionRegistry.write.initialize([
    ZERO_ADDRESS,
    schemaStack.universalDidResolver.address,
    schemaStack.schemaRegistry.address,
    schemaStack.roleControl.address,
  ])
  return { ...schemaStack, credentialDefinitionRegistry }
}

export async function deployRevocationStack(viem: Viem) {
  const credDefStack = await deployCredentialDefinitionStack(viem)
  const revocationRegistry = await viem.deployContract('RevocationRegistry')
  await revocationRegistry.write.initialize([
    ZERO_ADDRESS,
    credDefStack.universalDidResolver.address,
    credDefStack.credentialDefinitionRegistry.address,
    credDefStack.roleControl.address,
  ])
  return { ...credDefStack, revocationRegistry }
}

export async function deployLegacyStack(viem: Viem) {
  const didStack = await deployDidStack(viem)
  const legacyMappingRegistry = await viem.deployContract('LegacyMappingRegistry')
  await legacyMappingRegistry.write.initialize([
    ZERO_ADDRESS,
    didStack.universalDidResolver.address,
    didStack.roleControl.address,
  ])
  return { ...didStack, legacyMappingRegistry }
}
