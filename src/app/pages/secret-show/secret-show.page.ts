import { Component } from '@angular/core'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { LifehashService } from 'src/app/services/lifehash/lifehash.service'
import { AdvancedModeType, VaultStorageKey, VaultStorageService } from 'src/app/services/storage/storage.service'

import { MnemonicSecret } from '../../models/secret'
import { DeviceService } from '../../services/device/device.service'
import { ErrorCategory, handleErrorLocal } from '../../services/error-handler/error-handler.service'
import { NavigationService } from '../../services/navigation/navigation.service'

@Component({
  selector: 'airgap-secret-show',
  templateUrl: './secret-show.page.html',
  styleUrls: ['./secret-show.page.scss']
})
export class SecretShowPage {
  public readonly secret: MnemonicSecret
  public readonly startTime: Date = new Date()

  public lifehashData: string | undefined

  public isBlurred: boolean = true
  blurText =
    '****** **** ***** **** ******* ***** ***** ****** ***** *** ***** ******* ***** **** ***** ********* ***** ****** ***** **** ***** ******* ***** ****'

  public isAdvancedMode$: Observable<boolean> = this.storageService
    .subscribe(VaultStorageKey.ADVANCED_MODE_TYPE)
    .pipe(map((res) => res === AdvancedModeType.ADVANCED))

  constructor(
    private readonly deviceService: DeviceService,
    private readonly navigationService: NavigationService,
    private readonly lifehashService: LifehashService,
    private readonly storageService: VaultStorageService
  ) {
    this.secret = this.navigationService.getState().secret
  }

  public async ionViewDidEnter(): Promise<void> {
    this.deviceService.enableScreenshotProtection({ routeBack: 'secret-setup' })
    const matches = this.secret.fingerprint ? this.secret.fingerprint.match(/.{1,2}/g) : null
    const bytes = matches ? new Uint8Array(matches.map((byte) => parseInt(byte, 16))) : new Uint8Array()
    this.lifehashData = await this.lifehashService.generateLifehash(bytes)
  }

  public ionViewWillLeave(): void {
    this.deviceService.disableScreenshotProtection()
  }

  public timeout: NodeJS.Timer

  changeBlur() {
    this.isBlurred = !this.isBlurred

    if (this.timeout) {
      clearTimeout(this.timeout)
    }

    this.timeout = setTimeout(() => {
      this.isBlurred = true
    }, 30_000)
  }

  public goToValidateSecret(): void {
    this.navigationService
      .routeWithState('secret-add', { secret: this.secret })
      .catch(handleErrorLocal(ErrorCategory.IONIC_NAVIGATION))
  }
}
