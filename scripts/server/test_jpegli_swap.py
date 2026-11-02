"""Unit tests for the integrity-refresh trigger of jpegli_swap.py (run by tests/jpegli-swap.test.ts)."""
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest import mock

spec = importlib.util.spec_from_file_location("jpegli_swap", os.path.join(os.path.dirname(__file__), "jpegli_swap.py"))
js = importlib.util.module_from_spec(spec)
spec.loader.exec_module(js)


class WithTmpMark(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.mark = os.path.join(self.tmp.name, "REFRESH_OWED")


class RefreshAfterRun(WithTmpMark):
    def test_zero_swaps_makes_no_call(self):
        trigger = mock.Mock(return_value=True)
        counts = {"skip_already_q80": 40, "skip_no_gain": 2, "skip_checksum_mismatch": 3}
        self.assertTrue(js.refresh_after_run(counts, False, trigger, self.mark))
        trigger.assert_not_called()

    def test_empty_run_makes_no_call(self):
        trigger = mock.Mock()
        self.assertTrue(js.refresh_after_run({}, False, trigger, self.mark))
        trigger.assert_not_called()

    def test_dry_run_makes_no_call_even_with_an_owed_mark(self):
        open(self.mark, "w").close()
        trigger = mock.Mock()
        self.assertTrue(js.refresh_after_run({"dry_run_ok": 901}, True, trigger, self.mark))
        trigger.assert_not_called()
        self.assertTrue(os.path.exists(self.mark))

    def test_a_swap_makes_exactly_one_call(self):
        trigger = mock.Mock(return_value=True)
        self.assertTrue(js.refresh_after_run({"swapped": 1, "skip_already_q80": 9}, False, trigger, self.mark))
        trigger.assert_called_once_with()
        self.assertFalse(os.path.exists(self.mark))

    def test_a_failed_call_leaves_the_owed_mark(self):
        self.assertFalse(js.refresh_after_run({"swapped": 5}, False, mock.Mock(return_value=False), self.mark))
        self.assertTrue(os.path.exists(self.mark))

    def test_an_owed_mark_is_honoured_by_a_run_with_zero_swaps_and_cleared_on_success(self):
        open(self.mark, "w").close()
        trigger = mock.Mock(return_value=True)
        self.assertTrue(js.refresh_after_run({"skip_already_q80": 3}, False, trigger, self.mark))
        trigger.assert_called_once_with()
        self.assertFalse(os.path.exists(self.mark))

    def test_an_owed_mark_survives_a_second_failure(self):
        open(self.mark, "w").close()
        self.assertFalse(js.refresh_after_run({}, False, mock.Mock(return_value=False), self.mark))
        self.assertTrue(os.path.exists(self.mark))


class TriggerIntegrityRefresh(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(js, "API_KEY_CONTAINER", "some-container")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_failure_is_logged_at_error_and_never_raises(self):
        err = io.StringIO()
        boom = subprocess.CalledProcessError(1, "docker")
        with mock.patch.object(js.subprocess, "run", side_effect=boom), redirect_stderr(err):
            self.assertFalse(js.trigger_integrity_refresh())
        self.assertIn("ERROR integrity refresh NOT queued", err.getvalue())

    def test_unset_container_is_an_error(self):
        err = io.StringIO()
        with mock.patch.object(js, "API_KEY_CONTAINER", None), redirect_stderr(err):
            self.assertFalse(js.trigger_integrity_refresh())
        self.assertIn("JPEGLI_SWAP_API_KEY_CONTAINER is not set", err.getvalue())

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


class Config(unittest.TestCase):
    def test_the_host_paths_have_no_default(self):
        with mock.patch.object(js, "ROOT_ON_HOST", None), mock.patch.object(js, "QUARANTINE", None):
            with self.assertRaises(SystemExit) as cm:
                js.require_config()
        self.assertIn("JPEGLI_SWAP_ROOT_ON_HOST", str(cm.exception))
        self.assertIn("JPEGLI_SWAP_QUARANTINE", str(cm.exception))

    def test_env_file_fills_the_gaps_and_the_real_environment_wins(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "env")
            with open(path, "w") as fh:
                fh.write("# comment\nJPEGLI_T_A='from-file'\nJPEGLI_T_B=from-file\n")
            env = {"JPEGLI_SWAP_ENV": path, "JPEGLI_T_B": "from-env"}
            with mock.patch.dict(os.environ, env):
                js.load_env_file()
                self.assertEqual(os.environ["JPEGLI_T_A"], "from-file")
                self.assertEqual(os.environ["JPEGLI_T_B"], "from-env")
            os.environ.pop("JPEGLI_T_A", None)


class MainWiring(WithTmpMark):
    """main() with the database, the encoder and the pause mocked: only the refresh wiring is under test."""

    def run_main(self, statuses, trigger, extra_args=()):
        ids = os.path.join(self.tmp.name, "ids.txt")
        with open(ids, "w") as fh:
            fh.write("".join(f"{i:08x}-0000-0000-0000-000000000000\n" for i in range(len(statuses))))
        it = iter(statuses)

        def fake_swap(*_):
            s = next(it)
            if isinstance(s, Exception):
                raise s
            return s

        patches = [
            mock.patch.object(js, "QUARANTINE", self.tmp.name),
            mock.patch.object(js, "ROOT_ON_HOST", self.tmp.name),
            mock.patch.object(js, "preflight"),
            mock.patch.object(js, "wait_while_paused"),
            mock.patch.object(js, "psql", return_value=[["id", "/p", "00", "1", "1"]] * len(statuses)),
            mock.patch.object(js, "swap_one", side_effect=fake_swap),
            mock.patch.object(js, "trigger_integrity_refresh", trigger),
            mock.patch.object(js.signal, "signal"),
            mock.patch.object(sys, "argv", ["jpegli_swap.py", "--ids-file", ids, *extra_args]),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        js.main()

    def test_one_swap_gives_one_call(self):
        trigger = mock.Mock(return_value=True)
        self.run_main(["swapped", "skip_already_q80"], trigger)
        trigger.assert_called_once_with()

    def test_zero_swaps_gives_no_call(self):
        trigger = mock.Mock(return_value=True)
        self.run_main(["skip_already_q80", "skip_no_gain"], trigger)
        trigger.assert_not_called()

    def test_dry_run_gives_no_call(self):
        trigger = mock.Mock(return_value=True)
        self.run_main(["dry_run_ok"], trigger, ["--dry-run"])
        trigger.assert_not_called()

    def test_a_failed_trigger_exits_1_and_leaves_the_owed_mark(self):
        with self.assertRaises(SystemExit) as cm:
            self.run_main(["swapped"], mock.Mock(return_value=False))
        self.assertEqual(cm.exception.code, 1)
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, "REFRESH_OWED")))

    def test_the_next_run_honours_the_mark_even_with_zero_swaps(self):
        open(os.path.join(self.tmp.name, "REFRESH_OWED"), "w").close()
        trigger = mock.Mock(return_value=True)
        self.run_main(["skip_already_q80"], trigger)
        trigger.assert_called_once_with()
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "REFRESH_OWED")))

    def test_a_crash_mid_loop_still_refreshes_the_swaps_done(self):
        trigger = mock.Mock(return_value=True)
        with self.assertRaises(RuntimeError):
            self.run_main(["swapped", RuntimeError("boom")], trigger)
        trigger.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
