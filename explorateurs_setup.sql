-- === TABLES EXPLORATEURS ===

CREATE TABLE IF NOT EXISTS explorateurs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  nom TEXT NOT NULL,
  handle TEXT,
  bio TEXT,
  photo_profil_url TEXT,
  photo_banniere_url TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  youtube_url TEXT,
  site_web TEXT,
  nb_abonnes INT,
  statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
  ordre INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS explorateur_lieux (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explorateur_id UUID REFERENCES explorateurs(id) ON DELETE CASCADE,
  lieu_id UUID REFERENCES lieux(id) ON DELETE CASCADE,
  commentaire TEXT,
  ordre INT DEFAULT 0,
  UNIQUE(explorateur_id, lieu_id)
);

CREATE TABLE IF NOT EXISTS explorateur_candidatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  instagram_url TEXT,
  tiktok_url TEXT,
  nb_abonnes INT,
  message TEXT,
  statut TEXT DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'accepte', 'refuse')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- === RLS ===

ALTER TABLE explorateurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE explorateur_lieux ENABLE ROW LEVEL SECURITY;
ALTER TABLE explorateur_candidatures ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut voir les explorateurs actifs
CREATE POLICY "explorateurs_public_read" ON explorateurs
  FOR SELECT USING (statut = 'actif');

-- Tout le monde peut voir les lieux des explorateurs
CREATE POLICY "explorateur_lieux_public_read" ON explorateur_lieux
  FOR SELECT USING (true);

-- Utilisateurs connectés peuvent soumettre une candidature
CREATE POLICY "candidatures_insert" ON explorateur_candidatures
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Chacun voit ses propres candidatures
CREATE POLICY "candidatures_own_read" ON explorateur_candidatures
  FOR SELECT USING (auth.uid() = user_id);

-- === EXEMPLE D'INSERTION (à adapter) ===
-- INSERT INTO explorateurs (nom, handle, bio, instagram_url, nb_abonnes, statut, ordre)
-- VALUES ('Bella & Moi', '@bellaetmoi', 'Mama de Bella, golden retriever parisienne 🐾', 'https://instagram.com/bellaetmoi', 12400, 'actif', 1);
