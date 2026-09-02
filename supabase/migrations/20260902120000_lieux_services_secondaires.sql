-- Un etablissement peut cumuler plusieurs activites (ex: une garderie qui fait aussi
-- toiletteur). `cat` reste la categorie principale (icone/filtre carte), ce nouveau
-- champ liste les services secondaires proposes en plus, avec le meme vocabulaire.
alter table lieux add column if not exists services_secondaires text[];
