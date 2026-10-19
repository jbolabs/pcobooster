"""Select an existing idle shared simulator; never create or claim a booted device."""
import json
import sys

SHARED_NAMES = ("agent-sim-1", "agent-sim-2", "agent-sim-3", "agent-sim-ipad")


def select_shared(data, requested=None):
    if requested and requested not in SHARED_NAMES:
        raise ValueError("Only shared agent-sim-1, agent-sim-2, agent-sim-3, or agent-sim-ipad may be used.")
    devices = [device for group in data["devices"].values() for device in group]
    for name in (requested,) if requested else SHARED_NAMES:
        matches = [device for device in devices if device["name"] == name and device.get("isAvailable", True)]
        if len(matches) > 1:
            raise ValueError(f"Multiple available simulators named {name}; resolve the ambiguity first.")
        if len(matches) == 1 and matches[0]["state"] == "Shutdown":
            return name, matches[0]["udid"]
    raise ValueError("No requested shared simulator is Shutdown. Ask the user to free one; do not create a simulator.")


if __name__ == "__main__":
    try:
        print("\t".join(select_shared(json.load(sys.stdin), sys.argv[1] if len(sys.argv) > 1 else None)))
    except ValueError as error:
        sys.exit(str(error))
