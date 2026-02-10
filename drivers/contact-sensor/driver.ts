'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class ContactSensorDriver extends AjaxSensorDriver {
  deviceCategory = 'contact_sensor' as const;
};
