Connect your Ajax security system to Homey and bring your intrusion, fire, and water protection into your smart home.

This app integrates with Ajax Systems security hubs, supporting both local network communication (SIA protocol) and cloud-based connection modes. No API key or cloud access is required for basic monitoring using SIA mode.

What you can do:
- Monitor your alarm state - see when your system is armed, disarmed, or in night mode
- Receive alarm events in real-time - fire, intrusion, water leak, tamper, and more
- Arm and disarm your Ajax system from Homey or through Homey flows (Enterprise API / Proxy modes)
- Monitor motion sensors, door/window contacts, smoke and fire detectors, water leak sensors, glass break detectors, and more
- Control smart plugs and relays
- Track battery levels, signal strength, and online status for all devices
- Use night mode for partial arming
- Trigger Homey flows on alarm events, system state changes, and device status

Connection modes:
- SIA Protocol (Local Network): Receive events directly from your hub over the local network using the industry-standard SIA DC-09 protocol. No API key or cloud access needed. Just configure your hub's Monitoring Station to send to your Homey's IP address.
- Enterprise API (User): Full cloud access with an Ajax API key and your account credentials
- Enterprise API (Company): Cloud access using a company token for managed installations
- Proxy Server: Cloud access through a third-party proxy server (no API key needed), with SSE real-time events

SIA Protocol mode (recommended for most users):
Your Ajax hub sends alarm events directly to Homey over your local network. Set it up in three steps:
1. Add an Ajax Hub in Homey and select "SIA Protocol" mode
2. Enter a listening port (default: 5000) and your hub's account ID
3. In the Ajax app, configure Hub Settings > Monitoring Station to point to your Homey's IP and port

SIA mode supports arm/disarm tracking, alarm events (fire, intrusion, water, tamper), night mode, supervision heartbeats, and optional AES-128 encryption. Note: SIA is receive-only. To arm/disarm from Homey, use Enterprise API or Proxy mode.

Supported devices:
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

Requirements:
- An Ajax hub on your local network (for SIA mode), or
- An Ajax Enterprise API key, company token, or compatible proxy server (for cloud modes)
