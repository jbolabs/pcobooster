"""Exercise the shell cleanup function without starting or querying any simulator."""
from pathlib import Path
import subprocess
import unittest

SCRIPT = Path(__file__).parents[1] / "release-smoke.sh"


class SmokeCleanupTest(unittest.TestCase):
    def run_cleanup(self, booted, initial_status=0, shutdown_status=0):
        source = SCRIPT.read_text()
        cleanup = source[source.index("cleanup() {"):source.index("trap cleanup EXIT")]
        command = f'''
stop_log() {{ :; }}
terminate() {{ echo terminate; }}
xcrun() {{ echo "$*"; return {shutdown_status}; }}
udid=owned-device
simulator=agent-sim-2
booted_here={booted}
{cleanup}
(exit {initial_status})
cleanup
'''
        return subprocess.run(["bash", "-c", command], capture_output=True, text=True, check=False)

    def test_shuts_down_only_owned_device(self):
        result = self.run_cleanup(1)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), ["terminate", "simctl shutdown owned-device"])

    def test_failure_before_boot_preserves_status_and_leaves_devices_alone(self):
        result = self.run_cleanup(0, initial_status=7)
        self.assertEqual((result.returncode, result.stdout), (7, ""))

    def test_shutdown_failure_fails_successful_run(self):
        result = self.run_cleanup(1, shutdown_status=1)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Could not shut down shared simulator agent-sim-2", result.stderr)

    def test_shutdown_does_not_hide_original_failure(self):
        self.assertEqual(self.run_cleanup(1, initial_status=7, shutdown_status=1).returncode, 7)


if __name__ == "__main__":
    unittest.main()
