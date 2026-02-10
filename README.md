# Ajax Systems

Control and monitor your Ajax security system from Homey.

This app integrates with Ajax Systems security hubs, supporting both local network communication (SIA protocol) and cloud-based connection modes. No API key or cloud access is required for basic monitoring using SIA mode.

## What you can do

- **Monitor your alarm state** - see when your system is armed, disarmed, or in night mode
- **Receive alarm events** - fire, intrusion, water leak, tamper, and more delivered to Homey in real-time
- **Arm and disarm** your Ajax system from Homey or through Homey flows (Enterprise API / Proxy modes)
- **Monitor sensors** - motion, door/window, smoke, fire, water leak, glass break, and more (Enterprise API / Proxy modes)
- **Control devices** - smart plugs, relays, and switches (Enterprise API / Proxy modes)
- **Track status** - battery levels, signal strength, and online status for all devices
- **Night mode** for partial arming scenarios
- **Flow integration** - trigger flows on alarm events, system state changes, and device status

## Connection modes

| Mode | Description | Requirements |
|------|-------------|--------------|
| **SIA Protocol** | Local network events from your hub using SIA DC-09 protocol. No API key or cloud access needed. | Configure hub Monitoring Station to send to Homey's IP |
| **Enterprise API (User)** | Full cloud access with API key + account email/password | Ajax Enterprise API key |
| **Enterprise API (Company)** | Cloud access using company token for managed installations | Ajax Enterprise API key + company token |
| **Proxy Server** | Cloud access through a third-party proxy server (no API key needed) | Compatible proxy server URL |

### SIA Protocol Mode (recommended for most users)

SIA mode works over your local network with no cloud dependency. Your Ajax hub sends alarm events directly to Homey using the industry-standard SIA DC-09 protocol. To set it up:

1. Add an Ajax Hub device in Homey and select "SIA Protocol" mode
2. Enter your desired listening port (default: 5000) and your hub's account ID
3. In the Ajax app, go to Hub Settings > Monitoring Station and configure:
   - Protocol: SIA or Contact ID (over SIA)
   - IP address: Your Homey's local IP address
   - Port: Same port you entered in step 2
   - Account number: Same account ID you entered in step 2
4. Events from your hub will now appear in Homey in real-time

SIA mode supports: arm/disarm state tracking, alarm events (fire, intrusion, water, tamper), night mode, supervision heartbeats, and optional AES-128 encryption.

Note: SIA is a receive-only protocol. To arm/disarm from Homey, you need Enterprise API or Proxy mode.

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

## Requirements

- An Ajax hub on your local network (for SIA mode), or
- An Ajax Enterprise API key, company token, or compatible proxy server (for cloud modes)
