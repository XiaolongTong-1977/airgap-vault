import { createSupportedProtocols, AirGapModule, ProtocolNetwork } from '@airgap/module-kit'
import { createArbitrumProtocol, ARBITRUM_PROTOCOL_IDENTIFIER, ARBITRUM_MAINNET_PROTOCOL_NETWORK } from './protocol'

export class ArbitrumModule implements AirGapModule {
  public readonly supportedProtocols = createSupportedProtocols({
    [ARBITRUM_PROTOCOL_IDENTIFIER]: {
      mainnet: ARBITRUM_MAINNET_PROTOCOL_NETWORK as ProtocolNetwork
    }
  })

  public async createOfflineProtocol(_identifier: string) {
    return createArbitrumProtocol()
  }

  public async createOnlineProtocol(_identifier: string, _networkOrId?: any) {
    return createArbitrumProtocol()
  }

  public async createBlockExplorer(_identifier: string, _networkOrId?: any) {
    const { EtherscanBlockExplorer } = await import('@airgap/ethereum/v1')
    return new EtherscanBlockExplorer('https://arbiscan.io')
  }

  public async createV3SerializerCompanion(): Promise<any> {
    return undefined
  }
}
