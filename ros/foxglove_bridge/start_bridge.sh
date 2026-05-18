#!/bin/bash
# Launch foxglove_bridge with CycloneDDS and QoS overrides
#
# Usage:
#   ./start_bridge.sh
#   ./start_bridge.sh --port 8765
#
# Prerequisites:
#   sudo apt install ros-${ROS_DISTRO}-rmw-cyclonedds-cpp
#   sudo apt install ros-${ROS_DISTRO}-foxglove-bridge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
export CYCLONEDDS_URI="file://${SCRIPT_DIR}/cyclonedds.xml"

ros2 launch foxglove_bridge foxglove_bridge_launch.xml \
  --params-file "${SCRIPT_DIR}/qos_overrides.yaml" \
  "$@"
