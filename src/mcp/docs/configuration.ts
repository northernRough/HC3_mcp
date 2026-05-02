// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const configurationGuide = {
      overview: 'Comprehensive HC3 configuration documentation covering all aspects of Home Center 3 setup and management.',
      
      network: {
        title: 'Network Settings',
        content: `
## Network Configuration

### LAN Connection
- DHCP: IP assigned dynamically by router
- Static: Manual IP configuration with reserved address
- Set via Configuration Interface > Network > LAN connection

### Wi-Fi Connection  
- Enable Wi-Fi and search for networks
- Support for hidden networks
- Static or DHCP IP assignment
- Access Point mode available

### Secure Connection
- HTTP: Standard connection without encryption
- HTTPS: Secure encrypted connection
- HTTP/HTTPS: Accept both connection types
- Certificate management for HTTPS

### Network Status Checking
- LED indicators on device housing
- Internet diode: Copper=connected, Red=disconnected
- LAN diode: Copper=connected, Fast pulse=connecting
- Wi-Fi diode: Copper=connected, Red=error, Green=AP mode
        `
      },

      users: {
        title: 'Users and Access Management',
        content: `
## User Management

### User Roles
- Admin: One user, full system configuration and device control
- User: Multiple users, device control and status viewing only

### Adding Users
1. Configuration Interface > Access > Users
2. Click "Add user"
3. Enter Name and E-mail (recommend FIBARO ID)
4. Local password sent to email address

### Remote Access via FIBARO ID
- Owner can share access through FIBARO ID
- Log into Remote Access portal
- Add user by FIBARO ID email
- Synchronize in Configuration Interface

### User Permissions
- Admin sets access to specific sections/devices
- Manage Access > Select sections/devices > Save
- Mobile device management per user
- PIN codes for alarm control
        `
      },

      rooms: {
        title: 'Rooms and Sections',
        content: `
## Room Organization

### Sections
- Represent areas in house (floors, wings)
- Rooms assigned to sections
- Add via Configuration Interface > Rooms > Manage sections

### Rooms
- Represent actual rooms and places
- Devices assigned to rooms
- Categories for filtering by type
- Icons for visual representation
- Default room for new devices

### Room Management
- Add/Edit/Delete rooms
- Set room category, name, section, icon
- Default room configuration in General settings
- Automatic device assignment to default room
        `
      },

      zwave: {
        title: 'Z-Wave Configuration',
        content: `
## Z-Wave Network Management

### Z-Wave Settings
- Reconfigure all devices or single devices
- Reconfigure mesh network topology
- Broadcast Node Information frames
- Secondary controller management
- Controller transfer capabilities

### Network Optimization
- Reset energy metering data
- Reset entire Z-Wave network
- Enable/disable device polling
- Configure polling intervals
- Mark unavailable nodes
- Poll unavailable devices

### Device Management
- Add/remove Z-Wave devices
- Device configuration parameters
- Association groups management
- Firmware updates
- Device inclusion/exclusion modes
        `
      },

      time: {
        title: 'Time and Location Settings',
        content: `
## Time Configuration

### Date and Time Settings
- Time zone selection
- NTP server synchronization or manual time
- Date format configuration (DD/MM/YYYY, MM/DD/YYYY)
- Hour format (12-hour or 24-hour)

### Units and Separators
- Temperature unit (Celsius/Fahrenheit)
- Wind speed unit (km/h, mph)
- Decimal mark (comma or dot)

### Location Services
- Home location for weather and automation
- Work and other location zones
- GPS coordinates and radius settings
- Location-based scene triggers
- Enter/leave zone automation
        `
      },

      location: {
        title: 'Location and Geofencing',
        content: `
## Location-Based Features

### Home Location Setup
1. Configuration Interface > General > Location
2. Drag map to home address
3. Click location to set pin
4. Set radius (typically 100m for home)
5. Save configuration

### Additional Locations
- Add work, vacation homes, etc.
- Custom names and radius settings
- Multiple location zones supported
- Location-based automation triggers

### Geofencing Automation
- Enter/leave zone triggers
- User-specific location tracking
- Mobile device GPS integration
- Scene activation based on presence
        `
      },

      voip: {
        title: 'VoIP Server Configuration',
        content: `
## VoIP Server Setup

### Home Center VoIP Server
- HC3 can act as VoIP server
- Manages VoIP connections between clients
- Requires compatible VoIP mobile apps
- Gateway must be reachable via network

### Adding VoIP Clients
1. Configuration Interface > VoIP
2. Click "Add VoIP client"
3. Enter Display name, username, password
4. Client appears in user list
5. Enable/disable clients as needed

### Mobile App Configuration
- Enter HC3 IP address in VoIP app
- Use VoIP username and password
- Various VoIP apps supported
- Test connectivity and call quality
        `
      }
    };
