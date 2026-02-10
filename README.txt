Connect your Ajax security system to Homey and bring your intrusion, fire, and water protection into your smart home.

This app connects to the Ajax Systems cloud, giving you full control over your hubs, security groups, and all connected devices directly from Homey. Multiple connection methods are supported, including the Ajax Enterprise API, company tokens, and third-party proxy servers.

What you can do:
- Arm and disarm your Ajax system from Homey or through Homey flows
- Monitor motion sensors, door/window contacts, smoke and fire detectors, water leak sensors, glass break detectors, and more
- Control smart plugs and relays
- Track battery levels, signal strength, and online status for all devices
- Use night mode for partial arming
- Get real-time alerts through Homey flows when alarms trigger, devices go offline, or your system state changes

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

Connection modes:
- User Mode: Connect with an Ajax API key and your account credentials
- Company Mode: Connect using a company token for managed installations
- Proxy Mode: Connect through a third-party proxy server (no API key needed), with SSE real-time events

Optional real-time updates via AWS SQS allow near-instant event delivery when using direct API modes. Without SQS, the app polls your system at configurable intervals (default 10 seconds when armed, 30 seconds when disarmed).

Requirements:
- An Ajax account with access to your hubs
- One of the following: an Ajax Systems API key, a company token, or a compatible proxy server
