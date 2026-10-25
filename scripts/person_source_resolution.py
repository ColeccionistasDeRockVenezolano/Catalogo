"""Conservative person identity from names/aliases AND documented projects."""
from rym_identity import norm


def resolve_person(name, artist_id, persons, index, projects, canonical_names=None):
    key = norm(name)
    if len(key.split()) < 2:
        return {'status':'needs_review','reason':'one_word','candidateIds':sorted(index.get(key,set()))}
    exact = set(index.get(key,set()))
    linked = {pid for pid in exact if (pid,artist_id) in projects}
    if len(linked)==1:
        return {'status':'resolved','reason':'exact_name_or_alias_and_project','personId':next(iter(linked)),'candidateIds':sorted(exact)}
    canonical_names=canonical_names if canonical_names is not None else {p['id']:norm(p['name']) for p in persons}
    if len(exact)==1 and canonical_names.get(next(iter(exact)))==key:
        return {'status':'resolved','reason':'unique_exact_full_canonical_name','personId':next(iter(exact)),'candidateIds':sorted(exact)}
    if exact:
        return {'status':'needs_review','reason':'ambiguous_or_no_project','candidateIds':sorted(exact)}
    parts=key.split()
    short=[]
    for person in persons:
        if (person['id'],artist_id) not in projects:
            continue
        full=norm(person['name']).split()
        if full and parts[0]==full[0] and set(parts)<=set(full) and (len(parts)>=3 or parts[-1]==full[-1]):
            short.append(person['id'])
    if len(set(short))==1:
        return {'status':'resolved','reason':'documented_short_name_and_project','personId':short[0],'candidateIds':short}
    if short:
        return {'status':'needs_review','reason':'ambiguous_short_name','candidateIds':sorted(set(short))}
    return {'status':'new_candidate','reason':'no_exact_or_project_candidate','candidateIds':[]}


def is_group_member_edge(info, relation):
    return info.get('type')=='Group' and relation.get('type')=='member of band' and relation.get('direction')=='backward'
