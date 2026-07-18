-- ────────────────────────────────────────────────────────────────────────────
-- Les Wafou — Ajout partenaire
-- À exécuter dans Supabase > SQL Editor
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Ajouter la colonne instagram_url (sans erreur si déjà existante)
ALTER TABLE partenaires ADD COLUMN IF NOT EXISTS instagram_url TEXT;

-- 2. Insérer le partenaire Les Wafou
INSERT INTO partenaires (nom, description, logo_url, banniere_url, site_web, instagram_url, actif)
VALUES (
  'Les Wafou',
  'Fondée par amour pour Nala, une bully de 6 ans, Les Wafou est née du refus des stéréotypes. La marque crée des accessoires et jouets pensés pour tous les chiens — du collier au harnais en passant par les manteaux. Ici, chaque chien mérite le meilleur, de la truffe aux papattes.',
  'https://leswafou.com/cdn/shop/files/Les_Wafou_I_Logo_500_x_200_px_6ffebcca-88d9-4b04-9e83-3c364f9a1d44.png',
  'https://leswafou.com/cdn/shop/files/IMG_4855_83fa64e1-6475-4d9d-9b3a-a8193a97a0f5.jpg',
  'https://leswafou.com',
  'https://www.instagram.com/leswafou/',
  true
);

-- 3. Insérer les posts / photos
INSERT INTO partenaire_posts (partenaire_id, titre, contenu, type, image_url, lien, actif)
VALUES
  (
    (SELECT id FROM partenaires WHERE nom = 'Les Wafou'),
    'Harnais pour tous les gabarits',
    'Tweed, moumoute, velours côtelé... Des harnais conçus pour les petits et les grands wouafs, avec des matières douces et des designs qui cassent les codes.',
    'news',
    'https://leswafou.com/cdn/shop/files/4FDBD81A-6FB3-468B-8B93-55D59BBA3B8C.jpg',
    'https://leswafou.com/collections/all',
    true
  ),
  (
    (SELECT id FROM partenaires WHERE nom = 'Les Wafou'),
    'Accessoires & vêtements',
    'Manteaux, pulls et bonnets pour que ton chien (et toi) affronte le quotidien avec style. Des pièces pensées pour durer.',
    'news',
    'https://leswafou.com/cdn/shop/files/0A876253-A12E-46C4-9326-65358FC67476.jpg',
    'https://leswafou.com/collections/all',
    true
  ),
  (
    (SELECT id FROM partenaires WHERE nom = 'Les Wafou'),
    'Nala teste et approuve',
    'Chaque produit est testé et approuvé par Nala, bully de 6 ans et "cerveau aboyant" de la marque. Parce que le bien-être du chien passe avant tout.',
    'news',
    'https://leswafou.com/cdn/shop/files/7B42289E-999E-4AE3-AAA0-8438C5FC1EEB.jpg',
    'https://leswafou.com',
    true
  );
