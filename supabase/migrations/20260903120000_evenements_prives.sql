-- Evenements prives + invitations, avec chat de groupe prive auto-cree.
-- Voir diagnostic + proposition validee avec l'utilisatrice (session du 2026-09-03).

create table if not exists evenements_prives (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  description text,
  date_heure timestamptz not null,
  lieu_id uuid references lieux(id),
  adresse text,
  ville text,
  lat double precision,
  lng double precision,
  image_url text,
  organisateur_id uuid not null references profils(id),
  conversation_id uuid references conversations(id),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists evenements_invitations (
  id uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements_prives(id) on delete cascade,
  invite_id uuid not null references profils(id),
  invited_by uuid not null references profils(id),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'accepte', 'refuse')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (evenement_id, invite_id)
);

create index if not exists idx_evenements_prives_organisateur on evenements_prives(organisateur_id);
create index if not exists idx_evenements_invitations_invite on evenements_invitations(invite_id);
create index if not exists idx_evenements_invitations_evenement on evenements_invitations(evenement_id);

alter table evenements_prives enable row level security;
alter table evenements_invitations enable row level security;

-- Visible par l'organisateur, et par toute personne invitee (quel que soit son statut
-- de reponse -- un invite en attente doit pouvoir voir l'event pour decider).
create policy "evenements_prives_select" on evenements_prives for select
  using (
    organisateur_id = auth.uid()
    or exists (select 1 from evenements_invitations
               where evenement_id = evenements_prives.id and invite_id = auth.uid())
  );

create policy "evenements_prives_insert" on evenements_prives for insert
  with check (organisateur_id = auth.uid());

create policy "evenements_prives_update" on evenements_prives for update
  using (organisateur_id = auth.uid());

-- Un invite voit ses propres invitations ; l'organisateur voit toutes les invitations
-- de ses events (pour savoir qui a repondu quoi).
create policy "evenements_invitations_select" on evenements_invitations for select
  using (
    invite_id = auth.uid()
    or exists (select 1 from evenements_prives
               where id = evenement_id and organisateur_id = auth.uid())
  );

-- Seul l'organisateur d'un event peut inviter quelqu'un dessus.
create policy "evenements_invitations_insert" on evenements_invitations for insert
  with check (
    invited_by = auth.uid()
    and exists (select 1 from evenements_prives
                where id = evenement_id and organisateur_id = auth.uid())
  );

-- Un invite ne peut modifier QUE sa propre ligne (repondre accepte/refuse).
create policy "evenements_invitations_update" on evenements_invitations for update
  using (invite_id = auth.uid())
  with check (invite_id = auth.uid());

-- L'ajout au salon de chat prive ne doit jamais dependre d'une action client (la policy
-- conversation_members "cm_insert" est ouverte a tout utilisateur authentifie -- s'appuyer
-- dessus pour l'acceptation reviendrait a proteger la confidentialite du salon par la seule
-- difficulte a deviner un UUID, pas par une vraie regle serveur). Ce trigger est donc le seul
-- chemin qui fait rejoindre le salon : un refus ne donne jamais acces au chat.
create or replace function join_conversation_on_invitation_accepted()
returns trigger language plpgsql security definer as $$
begin
  if new.statut = 'accepte' and old.statut <> 'accepte' then
    insert into conversation_members (conversation_id, user_id)
    select conversation_id, new.invite_id
    from evenements_prives where id = new.evenement_id and conversation_id is not null
    on conflict do nothing;
    new.responded_at = now();
  elsif new.statut = 'refuse' and old.statut <> 'refuse' then
    new.responded_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_evenement_invitation_response on evenements_invitations;
create trigger on_evenement_invitation_response
  before update on evenements_invitations
  for each row execute function join_conversation_on_invitation_accepted();
