"""Unit tests for the integrity-refresh trigger of jpegli_swap.py (run by tests/jpegli-swap.test.ts)."""
import importlib.util
import io
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr
from unittest import mock

spec = importlib.util.spec_from_file_location("jpegli_swap", os.path.join(os.path.dirname(__file__), "jpegli_swap.py"))
js = importlib.util.module_from_spec(spec)
spec.loader.exec_module(js)


class RefreshAfterRun(unittest.TestCase):
    def test_zero_swaps_makes_no_call(self):
        trigger = mock.Mock(return_value=True)
        counts = {"skip_already_q80": 40, "skip_no_gain": 2, "skip_checksum_mismatch": 3}
        self.assertTrue(js.refresh_after_run(counts, False, trigger))
        trigger.assert_not_called()

    def test_empty_run_makes_no_call(self):
        trigger = mock.Mock()
        self.assertTrue(js.refresh_after_run({}, False, trigger))
        trigger.assert_not_called()

    def test_dry_run_makes_no_call(self):
        trigger = mock.Mock()
        self.assertTrue(js.refresh_after_run({"dry_run_ok": 901}, True, trigger))
        trigger.assert_not_called()

    def test_a_swap_makes_exactly_one_call(self):
        trigger = mock.Mock(return_value=True)
        self.assertTrue(js.refresh_after_run({"swapped": 1, "skip_already_q80": 9}, False, trigger))
        trigger.assert_called_once_with()

    def test_a_failed_call_is_reported_to_the_caller(self):
        self.assertFalse(js.refresh_after_run({"swapped": 5}, False, mock.Mock(return_value=False)))


class TriggerIntegrityRefresh(unittest.TestCase):
    def test_failure_is_logged_at_error_and_never_raises(self):
        err = io.StringIO()
        boom = subprocess.CalledProcessError(1, "docker")
        with mock.patch.object(js.subprocess, "run", side_effect=boom), redirect_stderr(err):
            self.assertFalse(js.trigger_integrity_refresh())
        self.assertIn("ERROR integrity refresh NOT queued", err.getvalue())

    def test_empty_key_is_an_error(self):
        err = io.StringIO()
        done = subprocess.CompletedProcess([], 0, stdout="\n")
        with mock.patch.object(js.subprocess, "run", return_value=done), redirect_stderr(err):
            self.assertFalse(js.trigger_integrity_refresh())
        self.assertIn("IMMICH_API_KEY is empty", err.getvalue())

    def test_204_is_success_and_names_the_refresh_job(self):
        done = subprocess.CompletedProcess([], 0, stdout="k3y\n")
        resp = mock.MagicMock()
        resp.status = 204
        resp.__enter__.return_value = resp
        with mock.patch.object(js.subprocess, "run", return_value=done), \
                mock.patch.object(js.urllib.request, "urlopen", return_value=resp) as urlopen:
            self.assertTrue(js.trigger_integrity_refresh())
        req = urlopen.call_args.args[0]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.full_url, js.IMMICH_JOBS_URL)
        self.assertEqual(req.get_header("X-api-key"), "k3y")
        self.assertEqual(req.data, b'{"name": "integrity-checksum-mismatch-refresh"}')

    def test_any_other_status_is_an_error(self):
        done = subprocess.CompletedProcess([], 0, stdout="k3y\n")
        resp = mock.MagicMock()
        resp.status = 200
        resp.__enter__.return_value = resp
        err = io.StringIO()
        with mock.patch.object(js.subprocess, "run", return_value=done), \
                mock.patch.object(js.urllib.request, "urlopen", return_value=resp), redirect_stderr(err):
            self.assertFalse(js.trigger_integrity_refresh())
        self.assertIn("HTTP 200", err.getvalue())


if __name__ == "__main__":
    unittest.main()
