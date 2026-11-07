-- Profiles and Google sign-in.
--
-- A first and a last name, and a profile picture, that the account page sets (PUT
-- /api/account/profile, PUT /api/account/avatar). The picture itself is a file in R2 (the FILES
-- bucket, under avatars/); the row keeps only its key, a new one for every upload, so a picture's
-- address can be cached for good and a new picture is a new address.
--
-- google_sub is Google's id for the account ("sub" in its ID token): set when the account first
-- signs in with Google, and the way it is found again, since an address at Google can change. One
-- Google account belongs to one BounceReel account at most.
--
-- An account made with Google has no password: its password_hash is '' (NOT NULL stays, and
-- verifyPassword fails on anything that is not a stored hash), until it sets one through the
-- forgot-password mail.
--
-- All four are NULL for the existing rows, which is what they mean: no name, no picture, never
-- signed in with Google. Additive only, so the old Worker keeps working during the deploy.

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
