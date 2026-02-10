# Ajax Systems

Control and monitor your Ajax security system from Homey.

This app connects to the Ajax Systems cloud, giving you full control over your hubs, security groups, and all connected devices directly from Homey. Multiple connection methods are supported, including the Ajax Enterprise API, company tokens, and third-party proxy servers.

## What you can do

- **Arm and disarm** your Ajax system from Homey or through Homey flows
- **Monitor sensors** - motion, door/window, smoke, fire, water leak, glass break, and more
- **Control devices** - smart plugs, relays, and switches
- **Track status** - battery levels, signal strength, and online status for all devices
- **Night mode** for partial arming scenarios
- **Flow integration** - trigger flows on alarm events, system state changes, and device status

## Supported devices

- Hub 2 / Hub 2 Plus / Hub Hybrid
- Security Groups (per-group arm/disarm)
- MotionProtect, MotionProtect Plus, MotionProtect Outdoor, MotionCam, CombiProtect
- DoorProtect, DoorProtect Plus
- FireProtect, FireProtect Plus, FireProtect 2
- LeaksProtect
- GlassProtect
- HomeSiren, StreetSiren, StreetSiren DoubleDeck
- Socket, Relay, WallSwitch, LightSwitch
- Button, DoubleButton, SpaceControl
- LifeQuality air quality monitor

## Connection modes

| Mode | Description |
|------|-------------|
| **User Mode** | API key + account email/password |
| **Company Mode** | API key + company token for managed installations |
| **Proxy Mode** | Third-party proxy server (no API key needed), with SSE real-time events |

Optional AWS SQS integration for near-instant event delivery when using direct API modes.

## Requirements

- An Ajax account with access to your hubs
- One of the following: an Ajax Systems API key, a company token, or a compatible proxy server
