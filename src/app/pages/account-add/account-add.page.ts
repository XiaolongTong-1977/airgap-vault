import { Component } from '@angular/core'
import { ModalController, AlertController } from '@ionic/angular'
import { ICoinProtocol, ProtocolSymbols } from '@airgap/coinlib-core'

import { ErrorCategory, handleErrorLocal } from '../../services/error-handler/error-handler.service'
import { NavigationService } from '../../services/navigation/navigation.service'
import { SecretsService } from '../../services/secrets/secrets.service'
import { AdvancedModeType, VaultStorageKey, VaultStorageService } from '../../services/storage/storage.service'
import { LocalAuthenticationOnboardingPage } from '../local-authentication-onboarding/local-authentication-onboarding.page'
import { BIP39_PASSPHRASE_ENABLED } from 'src/app/constants/constants'
import { ProtocolService } from '@airgap/angular-core'
import { MnemonicSecret } from 'src/app/models/secret'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

interface ProtocolWrapper {
  protocol: ICoinProtocol
  isHDWallet: boolean
  isChecked: boolean
  customDerivationPath: string | undefined
  details: ProtocolDetails
}

interface ProtocolDetails {
  symbol: string
  identifier: ProtocolSymbols
  name: string
}

@Component({
  selector: 'airgap-account-add',
  templateUrl: './account-add.page.html',
  styleUrls: ['./account-add.page.scss']
})
export class AccountAddPage {
  public secret: MnemonicSecret
  public selectedProtocol: ICoinProtocol
  public formValid: boolean = false
  public protocolList: ProtocolWrapper[]
  public protocolDetails: ProtocolDetails[]
  public isHDWallet: boolean = false

  singleSelectedProtocol: ProtocolWrapper | undefined

  public isAdvancedMode: boolean = false
  public isBip39PassphraseEnabled: boolean = BIP39_PASSPHRASE_ENABLED
  public revealBip39Passphrase: boolean = false
  public bip39Passphrase: string = ''

  public isAppAdvancedMode$: Observable<boolean> = this.storageService
    .subscribe(VaultStorageKey.ADVANCED_MODE_TYPE)
    .pipe(map((res) => res === AdvancedModeType.ADVANCED))

  constructor(
    private readonly secretsService: SecretsService,
    private readonly storageService: VaultStorageService,
    private readonly protocolService: ProtocolService,
    private readonly modalController: ModalController,
    private readonly navigationService: NavigationService,
    private readonly alertController: AlertController
  ) {
    const state = this.navigationService.getState()
    this.secret = state.secret
  }

  public ionViewWillEnter(): void {
    const state = this.navigationService.getState()
    this.protocolService.getActiveProtocols().then(async (protocols: ICoinProtocol[]) => {
      const navigationIdentifier: ProtocolSymbols | undefined = state.protocol

      this.protocolList = await Promise.all(
        protocols.map(async (protocol) => {
          const [symbol, identifier, name, supportsHD] = await Promise.all([
            protocol.getSymbol(),
            protocol.getIdentifier(),
            protocol.getName(),
            protocol.getSupportsHD()
          ])
          const isChecked = navigationIdentifier === identifier

          return {
            protocol,
            isHDWallet: supportsHD,
            customDerivationPath: undefined,
            isChecked: isChecked,
            details: { symbol, identifier, name }
          }
        })
      )
      this.onProtocolSelected()
    })
  }

  public onProtocolSelected(): void {
    // Wait 1 tick so "isChecked" is updated
    setTimeout(async () => {
      const selectedProtocols = this.protocolList.filter((protocol) => protocol.isChecked)
      if (selectedProtocols.length === 0) {
        this.formValid = false
      } else {
        this.formValid = true
      }

      if (this.isAdvancedMode) {
        // Advanced mode: reset to standard path and native HD capability so user can edit manually
        await Promise.all(
          selectedProtocols.map(async (wrapper) => {
            wrapper.customDerivationPath = undefined
            wrapper.isHDWallet = await wrapper.protocol.getSupportsHD()
          })
        )
        if (selectedProtocols.length === 1) {
          this.singleSelectedProtocol = selectedProtocols[0]
          this.singleSelectedProtocol.customDerivationPath = await this.singleSelectedProtocol.protocol.getStandardDerivationPath()
        } else {
          this.singleSelectedProtocol = undefined
        }
      } else {
        // Non-advanced mode: auto-bump to next available derivation path
        await Promise.all(
          selectedProtocols.map(async (wrapper) => {
            const nextPath = await this.secretsService.getNextDerivationPathForProtocol(wrapper.protocol, this.secret)
            wrapper.customDerivationPath = nextPath.derivationPath
            wrapper.isHDWallet = nextPath.isHDWallet
          })
        )

        if (selectedProtocols.length === 1) {
          this.singleSelectedProtocol = selectedProtocols[0]
        } else {
          this.singleSelectedProtocol = undefined
        }
      }
    }, 0)
  }

  public async toggleHDWallet() {
    // "isHDWallet" can only be toggled if one protocol is checked
    const selectedProtocols = this.protocolList.filter((protocol) => protocol.isChecked)
    if (selectedProtocols.length === 1) {
      const selectedProtocol = selectedProtocols[0]
      const standardDerivationPath = await selectedProtocol.protocol.getStandardDerivationPath()
      if ((await selectedProtocol.protocol.getSupportsHD()) && selectedProtocol.isHDWallet) {
        selectedProtocol.customDerivationPath = standardDerivationPath
      } else {
        selectedProtocol.customDerivationPath = `${standardDerivationPath}/0/0`
      }
      this.singleSelectedProtocol = selectedProtocol
    } else {
      this.singleSelectedProtocol = undefined
    }
  }

  public async addWallet(): Promise<void> {
    const value: boolean = await this.storageService.get(VaultStorageKey.DISCLAIMER_HIDE_LOCAL_AUTH_ONBOARDING)
    if (!value) {
      const modal: HTMLIonModalElement = await this.modalController.create({
        component: LocalAuthenticationOnboardingPage
      })

      modal
        .onDidDismiss()
        .then(() => {
          this.addWalletAndReturnToAddressPage()
        })
        .catch(handleErrorLocal(ErrorCategory.IONIC_MODAL))

      modal.present().catch(handleErrorLocal(ErrorCategory.IONIC_MODAL))
    } else {
      this.addWalletAndReturnToAddressPage()
    }
  }

  private async addWalletAndReturnToAddressPage(): Promise<void> {
    const addAccount = async () => {
      const selectedProtocols = this.protocolList.filter((p) => p.isChecked)

      this.secretsService
        .addWallets(
          this.secret,
          await Promise.all(
            selectedProtocols.map(async (protocolWrapper: ProtocolWrapper) => {
              const protocol = protocolWrapper.protocol
              return {
                protocolIdentifier: await protocol.getIdentifier(),
                isHDWallet: protocolWrapper.isHDWallet,
                customDerivationPath: protocolWrapper.customDerivationPath ?? (await protocol.getStandardDerivationPath()),
                bip39Passphrase: this.bip39Passphrase,
                isActive: true
              }
            })
          )
        )
        .then((createdWallets) => {
          if (createdWallets.length === 1) {
            // Navigate directly to the new account's detail page
            this.navigationService
              .routeWithState('/account-address', { wallet: createdWallets[0], secret: this.secret }, { replaceUrl: true })
              .catch(handleErrorLocal(ErrorCategory.IONIC_NAVIGATION))
          } else {
            // Multiple wallets or no wallets created, go to accounts list
            this.navigationService
              .routeWithState('/accounts-list', { secret: this.secret }, { replaceUrl: true })
              .catch(handleErrorLocal(ErrorCategory.IONIC_NAVIGATION))
          }
        })
        .catch(handleErrorLocal(ErrorCategory.SECURE_STORAGE))
    }

    if (this.bip39Passphrase.length > 0) {
      const alert = await this.alertController.create({
        header: 'BIP-39 Passphrase',
        message:
          'You set a BIP-39 Passphrase. You will need to enter this passphrase again when you import your secret. If you lose your passphrase, you will lose access to your account!',
        backdropDismiss: false,
        inputs: [
          {
            name: 'understood',
            type: 'checkbox',
            label: 'I understand',
            value: 'understood',
            checked: false
          }
        ],
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Ok',
            handler: async (result: string[]) => {
              if (result.includes('understood')) {
                addAccount()
              }
            }
          }
        ]
      })
      alert.present()
    } else {
      addAccount()
    }
  }

  public goToIsolatedModule(): void {
    this.navigationService.route('/isolated-modules-list').catch(handleErrorLocal(ErrorCategory.IONIC_NAVIGATION))
  }

  public async testAllProtocols(): Promise<void> {
    const results: { name: string; symbol: string; identifier: string; status: string; error?: string; address?: string; time: number }[] = []

    // Same flow as secrets.service.ts createNewWallet — retrieve entropy from secure storage
    const entropy: string = await this.secretsService.retrieveEntropyForSecret(this.secret)
    const mnemonic: string = this.secret.recoverMnemonicFromHex(entropy)

    for (const wrapper of this.protocolList) {
      const proto = wrapper.protocol
      const start = Date.now()
      let identifier = '?'
      let symbol = '?'
      try {
        identifier = await proto.getIdentifier()
        symbol = await proto.getSymbol()
        const path = await proto.getStandardDerivationPath()
        const isHD = await proto.getSupportsHD()

        // Same flow as secrets.service.ts line 611-613
        const pubKey = isHD
          ? await proto.getExtendedPublicKeyFromMnemonic(mnemonic, path, '')
          : await proto.getPublicKeyFromMnemonic(mnemonic, path, '')

        // Try to derive address using protocol's own getAddressFromPublicKey
        let address: string = ''
        try {
          const r = await (proto as any).getAddressFromPublicKey(pubKey, 0)
          address = typeof r === 'string' ? r : String(r?.address || r)
        } catch (e: any) {
          address = 'ADDR_ERR: ' + String(e?.message || e).slice(0, 60)
        }

        results.push({
          name: wrapper.details.name,
          symbol,
          identifier,
          status: 'ok',
          address,
          time: Date.now() - start
        })
      } catch (e: any) {
        const fullStack = e?.stack || e?.message || String(e)
        console.error(`[TEST] FAIL ${wrapper.details.name} (${identifier}):`, fullStack)
        results.push({
          name: wrapper.details.name,
          symbol,
          identifier,
          status: 'fail',
          error: String(e?.message || e).slice(0, 200),
          time: Date.now() - start
        })
      }
    }

    // group by status
    const pass = results.filter((r) => r.status === 'ok')
    const fail = results.filter((r) => r.status !== 'ok')

    console.log('=== TEST ALL PROTOCOLS RESULTS ===')
    console.log(`PASS: ${pass.length} / FAIL: ${fail.length} / TOTAL: ${results.length}`)
    for (const r of results) {
      if (r.status === 'ok') {
        console.log(`PASS  ${r.symbol.padEnd(8)} ${r.identifier.padEnd(20)} ${r.address || ''}  (${r.time}ms)`)
      } else {
        console.log(`FAIL  ${r.symbol.padEnd(8)} ${r.identifier.padEnd(20)} ${r.error}`)
      }
    }
    console.log('==================================')

    // Output results to DOM so uiautomator can read them
    const div = document.createElement('div')
    div.id = 'test-results'
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;max-height:80vh;overflow-y:auto;background:white;color:black;padding:10px;font-family:monospace;font-size:11px;z-index:99999;'
    div.innerHTML = [
      `<h3>Protocol Test Results</h3>`,
      `<p><strong>PASS: ${pass.length} / FAIL: ${fail.length} / TOTAL: ${results.length}</strong></p>`,
      '<hr>',
      ...results.map((r) =>
        r.status === 'ok'
          ? `<div style="color:green">OK   ${r.symbol.padEnd(8)} ${r.identifier.padEnd(18)} ${r.address || ''}</div>`
          : `<div style="color:red">FAIL ${r.symbol.padEnd(8)} ${r.identifier.padEnd(18)} ${r.error || ''}</div>`
      )
    ].join('\n')
    document.body.appendChild(div)

    const lines = [
      `PASS: ${pass.length} / FAIL: ${fail.length}`,
      '',
      ...fail.map((r) => `FAIL  ${r.symbol} (${r.identifier}): ${r.error}`)
    ]
    const alert = await this.alertController.create({
      header: 'Protocol Test Results',
      message: lines.join('\n'),
      buttons: ['OK']
    })
    await alert.present()
  }
}
