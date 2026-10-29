import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('blogger_capture', ROOT / 'docs/capturas/vzlarockea-2026-10-27/capture_blogger.py')
CAPTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAPTURE)


class OriginalImageUrls(unittest.TestCase):
    def test_nested_blogger_path_requests_original_and_deduplicates(self):
        base = 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/ASSET/'
        variants = [base + 's72-c/front.jpg', base + 's320/front.jpg', base + 'w320-h240-c/front.jpg', base + 's1600/front.jpg']
        self.assertEqual({CAPTURE.original_url(u) for u in variants}, {base + 's0/front.jpg'})
        self.assertEqual(len({CAPTURE.asset_key(u) for u in variants}), 1)

    def test_terminal_size_is_part_of_path_not_query(self):
        url = 'https://blogger.googleusercontent.com/img/a/ASSET=s72-w320-h320-c'
        self.assertEqual(CAPTURE.original_url(url), 'https://blogger.googleusercontent.com/img/a/ASSET=s0')
        self.assertEqual(CAPTURE.asset_key(url), 'https://blogger.googleusercontent.com/img/a/ASSET')

    def test_original_keeps_real_query_and_other_urls_unchanged(self):
        url = 'https://example.org/music/front.jpg?token=public'
        self.assertEqual(CAPTURE.original_url(url), url)
        url = 'https://blogger.googleusercontent.com/img/a/ASSET=s320?x=1'
        self.assertEqual(CAPTURE.original_url(url), 'https://blogger.googleusercontent.com/img/a/ASSET=s0?x=1')


if __name__ == '__main__':
    unittest.main()
