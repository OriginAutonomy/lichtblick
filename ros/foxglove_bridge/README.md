# Foxglove Bridge Configuration

Configuration files for running `foxglove_bridge` with CycloneDDS and proper QoS settings for nvblox/Isaac ROS topics.

## Quick Start

```bash
./start_bridge.sh
```

## Files

| File | Purpose |
|------|---------|
| `cyclonedds.xml` | CycloneDDS network config (UDP, no shared memory, peer discovery) |
| `qos_overrides.yaml` | Per-topic QoS overrides for foxglove_bridge |
| `start_bridge.sh` | Launch script that sets RMW + CycloneDDS config + QoS |

## Prerequisites

```bash
sudo apt install ros-${ROS_DISTRO}-rmw-cyclonedds-cpp
sudo apt install ros-${ROS_DISTRO}-foxglove-bridge
```

## Configuration

### Network Interface

Edit `cyclonedds.xml` and change the interface name to match your setup:

```xml
<NetworkInterface name="eno1" />
```

### Peer Discovery

Edit the `<Peers>` section to point to your robot's IP:

```xml
<Peers>
    <Peer address="192.168.5.1" />
</Peers>
```

The robot's CycloneDDS config must peer back to this machine's IP.

### QoS Overrides

Edit `qos_overrides.yaml` to add topics that need non-default QoS. Common issue: topics publishing with `BEST_EFFORT` reliability won't be received if the bridge subscribes with `RELIABLE` (the default).

```yaml
foxglove_bridge:
  ros__parameters:
    qos_overrides:
      /your/topic:
        reliability: best_effort
        durability: volatile
```

### Domain ID

All ROS2 nodes must use the same domain ID. Default is 0. Set via:

```bash
export ROS_DOMAIN_ID=0
```

## Troubleshooting

**Topics appear in Lichtblick topic list but have no data:**
- Most likely a QoS mismatch. Check the topic's QoS with `ros2 topic info -v /topic_name` and add matching overrides.

**Topics don't appear at all:**
- Verify CycloneDDS peer addresses are correct on both sides
- Verify same `ROS_DOMAIN_ID` on both machines
- Verify same `RMW_IMPLEMENTATION` on all nodes: `ros2 doctor --report | grep middleware`

**3D panel sidebar doesn't show topic toggles:**
- The topic's schema must match a registered extension. Standard ROS2 types (nav_msgs/msg/Path, sensor_msgs/msg/Image) are supported. Custom message types need a SceneExtension registered for their schema.
