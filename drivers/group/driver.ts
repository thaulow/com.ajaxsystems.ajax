'use strict';

import Homey from 'homey';

module.exports = class GroupDriver extends Homey.Driver {

  async onInit(): Promise<void> {
    this.log('Group driver initialized');
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('list_devices', async () => {
      const app = this.homey.app as any;
      if (!app?.isReady()) {
        throw new Error('App not ready. Please add a hub first.');
      }

      const api = app.getApi();
      const coordinator = app.getCoordinator();
      const devices: any[] = [];

      for (const hubId of coordinator.getAllHubIds()) {
        const hub = coordinator.getHub(hubId);
        if (!hub?.groupsEnabled) continue;

        const groups = await api.getGroups(hubId);
        for (const group of groups) {
          devices.push({
            name: `${group.name} (${hub.name})`,
            data: {
              id: group.id,
              groupId: group.id,
              hubId,
            },
          });
        }
      }

      if (devices.length === 0) {
        throw new Error('No security groups found. Groups must be enabled on your Ajax hub.');
      }

      return devices;
    });
  }

};
