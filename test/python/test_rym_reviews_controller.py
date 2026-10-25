"""Offline lifecycle checks: invalid bodies stay pending; shutdown preserves a resumable queue."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
spec=importlib.util.spec_from_file_location('review_controller',Path(__file__).resolve().parents[2]/'scripts/rym-reviews-control.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from test_rym_reviews_validation import HTML

class FakePage:
 def __init__(self,stage,valid):self.stage=stage;self.valid=valid;self.url=''
 async def goto(self,url,**kw):self.url=url;return SimpleNamespace(status=200)
 async def wait_for_selector(self,*a,**kw):pass
 async def content(self):
  if not self.valid:(self.stage/'PAUSE').touch()
  return HTML if self.valid else HTML.replace('/music-review/Ana/famasloop/la_quema/42','/music-review/Ana/the-clash/the-clash/42')
 async def close(self):raise RuntimeError('driver closed during shutdown')

class FakeContext:
 def __init__(self,stage,valid):self.stage=stage;self.valid=valid
 async def new_page(self):return FakePage(self.stage,self.valid)

class FakePlaywright:
 def __init__(self,stage,valid):self.stage=stage;self.valid=valid;self.chromium=self
 async def __aenter__(self):return self
 async def __aexit__(self,*a):pass
 async def connect_over_cdp(self,*a):return SimpleNamespace(contexts=[FakeContext(self.stage,self.valid)])

class ControllerTest(unittest.TestCase):
 def run_capture(self,valid):
  with tempfile.TemporaryDirectory() as root:
   stage=Path(root);task={'href':'/release/album/famasloop/la_quema/','page':1,'base':'famasloop','out':'famasloop_reviews_1',
                         'url':'https://rateyourmusic.com/release/album/famasloop/la_quema/reviews/1/'}
   (stage/'tareas.jsonl').write_text(json.dumps(task)+'\n')
   args=SimpleNamespace(stage=str(stage),target_rps=9,chrome_tabs=1,cdp='mock',firefox_bridge='mock')
   with patch('playwright.async_api.async_playwright',lambda:FakePlaywright(stage,valid)),patch.object(m,'firefox_get',side_effect=RuntimeError('offline')):
    self.assertEqual(asyncio.run(m.collect(args)),0)
   state=json.loads((stage/'controller-state.json').read_text())
   pending=json.loads((stage/'pending-at-close.json').read_text())
   if valid:
    self.assertEqual(state['status'],'complete');self.assertEqual(state['completed'],1);self.assertEqual(pending,[])
    self.assertEqual(len((stage/'reviews.jsonl').read_text().splitlines()),1)
   else:
    self.assertEqual(state['status'],'paused_with_pending');self.assertEqual(state['completed'],0)
    self.assertEqual(len(pending),1);self.assertEqual(len(list((stage/'pages').glob('*.json'))),0)
    self.assertGreaterEqual(state['rejected'],1)
 def test_valid_capture_and_closed_driver(self):self.run_capture(True)
 def test_wrong_body_is_retryable(self):self.run_capture(False)

if __name__=='__main__':unittest.main()
