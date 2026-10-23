# MCA OpenHealth Indy Besu Contracts

Contratos Solidity para identidade descentralizada (DID), autorização de contas,
validação de transações e gerenciamento de recursos AnonCreds em redes compatíveis
com Ethereum, incluindo Hyperledger Besu.

O projeto usa Solidity 0.8.34 e Hardhat 3. Os testes TypeScript usam `node:test`
e viem.

## Requisitos

- Node.js compatível com Hardhat 3
- npm

## Preparar o ambiente

Na raiz do repositório, instale as dependências e compile os contratos:

```sh
npm ci
npx hardhat build
```

A compilação gera os artifacts consumidos pelos testes e pelo gerador de genesis.

## Contratos

### Autorização — `contracts/auth/`

- **RoleControl**: atribui, consulta e revoga os papéis `TRUSTEE`, `ENDORSER` e
  `STEWARD`. Trustees podem gerenciar os papéis e a contagem de contas por papel é
  mantida para as regras de aprovação de upgrades.
- **AccountControl**: decide se uma transação é permitida. Exige papel Trustee
  para implantar contratos; transações para contratos existentes são aceitas por
  esta regra.

### Rede — `contracts/network/`

- **ValidatorControl**: mantém a lista de validadores e associa cada endereço de
  validador à conta responsável. A inclusão e remoção exigem papel Steward; não
  permite remover o último validador.

### Upgrades — `contracts/upgrade/`

- **UpgradeControl**: controla propostas de upgrade para implementações UUPS.
  Trustees propõem e aprovam upgrades; é necessário atingir o quórum configurado
  no contrato (60% dos Trustees).
- **ControlledUpgradeable**: base compartilhada que autoriza upgrades através do
  UpgradeControl.

### Identidade — `contracts/did/`

- **IndyDidRegistry**: cria, atualiza, desativa e resolve documentos DID
  `did:indybesu`. Suporta operações assinadas pelo proprietário, submetidas por
  contas autorizadas.
- **EthereumExtDidRegistry**: estende o registro ERC-1056 (`EthereumDIDRegistry`)
  com suporte a proxy UUPS.
- **UniversalDidResolver**: resolve documentos `did:indybesu` e metadados para
  `did:indybesu` e `did:ethr`.
- **DidUtils**: utilitários internos para analisar DIDs e converter identificadores.

### AnonCreds — `contracts/anoncreds/`

- **SchemaRegistry**: registra e resolve schemas.
- **CredentialDefinitionRegistry**: registra definições de credenciais associadas
  a um schema existente.
- **RevocationRegistry**: registra definições de revogação associadas a uma
  Credential Definition e publica entradas de revogação.
- **AnoncredsRegistry**: lógica compartilhada de validação de emissor, identidade
  e permissões.
- Os arquivos `*Types.sol`, `*Interface.sol` e `AnoncredsErrors.sol` declaram
  estruturas, interfaces e erros usados pelos registros.

### Migração — `contracts/migration/`

- **LegacyMappingRegistry**: mapeia identificadores DID e recursos do formato
  legado Indy/Sov para os identificadores atuais. A validação da assinatura
  Ed25519 está indicada no contrato como trabalho futuro.

### Utilitários e contratos de teste

- `contracts/utils/`: utilitários internos de Base58, strings e erros.
- `contracts/testonly/`: contratos de apoio aos testes, incluindo implementações
  de exemplo para validar upgrades.

## Scripts de setup e operação

### Gerar o JSON de genesis

O executável `indy-besu-generate-genesis` compõe os trechos de storage e bytecode
dos contratos no formato de genesis esperado pela rede. Os endereços e as
referências aos artifacts dos contratos vêm de `references.json`; compile o
projeto antes de gerar o arquivo.

```sh
npx hardhat build
npx indy-besu-generate-genesis \
  --validator 0x93917cadbace5dfce132b991732c6cda9bcc5b8a:0xed9d02e382b34818e88b88a309c7fe71e65f419d \
  --validator 0x27a97c9aaf04f18f3014c32e036dd0ac76da5f18:0xb30f304642de3fee4365ed5cd06ea2e69d3fd0ca \
  --account 0x0000000000000000000000000000000000000001:Endorser \
  --account 0x0000000000000000000000000000000000000002:Steward \
  --output ./ContractsGenesis.json
```

Argumentos:

- `--validator <endereço-do-validador>:<endereço-da-conta>`: adiciona um validador
  e sua conta associada. Pode ser repetido.
- `--account <endereço>:<papel>`: adiciona uma conta com papel `Trustee`,
  `Endorser` ou `Steward`. Pode ser repetido.
- `--output <arquivo.json>`: caminho do JSON gerado.
- `--help`: mostra a ajuda do comando.

Cada conta associada a um validador é incluída automaticamente em `accounts` com
papel Trustee. Essas contas e os endereços de validador não podem ser informados
novamente por `--account`. A lista `validators` contém cada validador e sua conta
associada.

### Transação de exemplo na rede OP simulada

O script `scripts/send-op-tx.ts` cria uma conexão local `hardhatOp`, estima o
componente de gas L1 e envia uma transação de 1 wei da conta de teste para ela
mesma:

```sh
npx hardhat run scripts/send-op-tx.ts
```

## Testes

Execute a suíte completa:

```sh
npx hardhat test
```

Ou execute apenas os testes TypeScript com `node:test`:

```sh
npx hardhat test nodejs
```

## Configuração de redes Hardhat

O arquivo `hardhat.config.ts` define duas redes locais simuladas:

- `hardhatMainnet`: simulação EVM L1.
- `hardhatOp`: simulação com tipo de chain OP.

Também há uma configuração HTTP para Sepolia, que requer as variáveis
`SEPOLIA_RPC_URL` e `SEPOLIA_PRIVATE_KEY`. Esta configuração fornece a conexão
de rede; os módulos de exemplo em `ignition/modules/` não representam o deploy
do conjunto de contratos do projeto.
