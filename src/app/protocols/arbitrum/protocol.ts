import { EthereumBaseProtocolImpl, DEFAULT_ETHEREUM_UNITS_METADATA, HttpEthereumNodeClient, EtherscanInfoClient, EthereumProtocolNetwork } from '@airgap/ethereum/v1'
import { newAmount } from '@airgap/module-kit'

export const ARBITRUM_MAINNET_PROTOCOL_NETWORK: EthereumProtocolNetwork = {
  name: 'Mainnet',
  type: 'mainnet',
  rpcUrl: 'https://arb1.arbitrum.io/rpc',
  chainId: 42161,
  blockExplorerUrl: 'https://arbiscan.io',
  blockExplorerApi: 'https://api.arbiscan.io'
}

export const ARBITRUM_PROTOCOL_IDENTIFIER = 'arbitrum'

export function createArbitrumProtocol(network: Partial<EthereumProtocolNetwork> = {}) {
  const completeNetwork: EthereumProtocolNetwork = { ...ARBITRUM_MAINNET_PROTOCOL_NETWORK, ...network }

  const nodeClient = new HttpEthereumNodeClient(completeNetwork.rpcUrl)
  const infoClient = new EtherscanInfoClient(completeNetwork.blockExplorerApi)

  return new EthereumBaseProtocolImpl(nodeClient, infoClient, {
    network: completeNetwork,
    identifier: ARBITRUM_PROTOCOL_IDENTIFIER,
    name: 'Arbitrum',
    units: {
      ...DEFAULT_ETHEREUM_UNITS_METADATA,
      ETH: {
        symbol: { value: 'ARB', market: 'eth' },
        decimals: DEFAULT_ETHEREUM_UNITS_METADATA.ETH.decimals
      }
    },
    mainUnit: 'ETH',
    feeDefaults: {
      low: newAmount('21000', 'GWEI').blockchain(DEFAULT_ETHEREUM_UNITS_METADATA),
      medium: newAmount('42000', 'GWEI').blockchain(DEFAULT_ETHEREUM_UNITS_METADATA),
      high: newAmount('84000', 'GWEI').blockchain(DEFAULT_ETHEREUM_UNITS_METADATA)
    }
  })
}
