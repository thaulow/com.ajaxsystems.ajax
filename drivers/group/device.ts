'use strict';

import { AjaxBaseDevice } from '../../lib/base-device';
import { AjaxGroup } from '../../lib/types';

module.exports = class GroupDevice extends AjaxBaseDevice {

  private groupListenerBound: ((data: any) => void) | null = null;

  async onInit(): Promise<void> {
    this.log('Group device init:', this.getName());

    this.registerCapabilityListener('homealarm_state', async (value: string) => {
      await this.onAlarmStateSet(value);
    });

    this.registerCapabilityListener('ajax_night_mode', async (value: boolean) => {
      await this.onNightModeSet(value);
    });

    const ready = await this.waitForApp();
    if (!ready) {
      this.setUnavailable('App not ready').catch(this.error);
      return;
    }

    const coordinator = this.getCoordinator();
    this.groupListenerBound = (data: any) => this.onGroupStateChange(data);
    coordinator.on('groupStateChange', this.groupListenerBound);
    coordinator.on('dataUpdated', () => this.updateFromCoordinator());

    this.updateFromCoordinator();
  }

  async onUninit(): Promise<void> {
    const coordinator = this.getCoordinator();
    if (coordinator && this.groupListenerBound) {
      coordinator.removeListener('groupStateChange', this.groupListenerBound);
    }
  }

  private getGroupId(): string {
    return this.getData().groupId || this.getData().id;
  }

  private updateFromCoordinator(): void {
    const group = this.getCoordinator().getGroup(this.getHubId(), this.getGroupId());
    if (!group) return;
    this.updateCapabilities(group);
  }

  private onGroupStateChange(data: { hubId: string; groupId: string; group: AjaxGroup }): void {
    if (data.hubId !== this.getHubId() || data.groupId !== this.getGroupId()) return;
    this.updateCapabilities(data.group);
  }

  private updateCapabilities(group: AjaxGroup): void {
    let state = 'disarmed';
    if (group.state === 'ARMED') state = 'armed';
    else if (group.state === 'PARTIALLY_ARMED') state = 'partially_armed';

    this.safeSetCapability('homealarm_state', state);
    this.safeSetCapability('ajax_night_mode', group.nightModeEnabled);
  }

  private async onAlarmStateSet(value: string): Promise<void> {
    const api = this.getApi();
    const hubId = this.getHubId();
    const groupId = this.getGroupId();

    switch (value) {
      case 'armed':
        await api.setGroupArming(hubId, groupId, 'ARM');
        break;
      case 'disarmed':
        await api.setGroupArming(hubId, groupId, 'DISARM');
        break;
      default:
        await api.setGroupArming(hubId, groupId, 'ARM');
    }

    this.getCoordinator().refresh().catch(this.error);
  }

  private async onNightModeSet(value: boolean): Promise<void> {
    const api = this.getApi();
    const hubId = this.getHubId();
    const groupId = this.getGroupId();

    await api.setGroupArming(hubId, groupId, value ? 'NIGHT_MODE_ON' : 'NIGHT_MODE_OFF');
    this.getCoordinator().refresh().catch(this.error);
  }

};
