import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[2] / 'scripts/rhv-directorio-parse.py'
spec = importlib.util.spec_from_file_location('rhv_directorio_parse', path)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class PeopleParsingTests(unittest.TestCase):
    def test_unclosed_guillemets_do_not_swallow_following_guest(self):
        value = 'Jesús «Junior «Morales (violín en Irish moods), Ingrid Porras (voces en Ceol raga jam)'
        self.assertEqual(parser.split_people(value), [
            {'name': 'Jesús «Junior «Morales', 'role': 'violín en Irish moods'},
            {'name': 'Ingrid Porras', 'role': 'voces en Ceol raga jam'},
        ])

    def test_commas_in_roles_and_balanced_quotes_remain_inside_person(self):
        value = 'Diego «El Negro, músico» Álvarez (cajón, percusión), Ingrid Porras (voces)'
        self.assertEqual(len(parser.split_people(value)), 2)
        self.assertEqual(parser.split_people(value)[0]['role'], 'cajón, percusión')


if __name__ == '__main__':
    unittest.main()
