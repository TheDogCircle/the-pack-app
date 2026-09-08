-- Passe la cadence des notifs de proximite (evenements "Mise en avant") d'un
-- intervalle glissant (1x/semaine puis tous les 5 jours) a 5 paliers fixes :
-- 14j, 7j, 3j, veille, jour meme. Un tableau plutot qu'un simple curseur
-- timestamp pour tracer precisement quels paliers ont deja ete envoyes.
alter table evenements add column if not exists notif_paliers_envoyes int[] not null default '{}';
