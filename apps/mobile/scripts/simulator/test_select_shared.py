import unittest

from select_shared import select_shared


def inventory(*devices):
    return {"devices": {"runtime": [dict(name=name, udid=udid, state=state) for name, udid, state in devices]}}


class SharedSimulatorTest(unittest.TestCase):
    def test_selects_first_shutdown_in_shared_order(self):
        data = inventory(("agent-sim-3", "third", "Shutdown"), ("agent-sim-1", "busy", "Booted"), ("agent-sim-2", "second", "Shutdown"))
        self.assertEqual(select_shared(data), ("agent-sim-2", "second"))

    def test_explicit_shared_device(self):
        self.assertEqual(select_shared(inventory(("agent-sim-ipad", "ipad", "Shutdown")), "agent-sim-ipad"), ("agent-sim-ipad", "ipad"))

    def test_refuses_busy_missing_and_foreign_devices(self):
        data = inventory(("agent-sim-1", "busy", "Booted"), ("personal", "personal", "Shutdown"))
        for requested in (None, "agent-sim-1", "agent-sim-2", "personal"):
            with self.subTest(requested=requested), self.assertRaises(ValueError):
                select_shared(data, requested)

    def test_refuses_duplicate_names(self):
        with self.assertRaises(ValueError):
            select_shared(inventory(("agent-sim-1", "a", "Shutdown"), ("agent-sim-1", "b", "Shutdown")))


if __name__ == "__main__":
    unittest.main()
