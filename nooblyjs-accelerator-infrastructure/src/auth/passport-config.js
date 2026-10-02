const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

const USERS_FILE = path.join(__dirname, '../../data/users.json');
const GOOGLE_CONFIG = require('../../data/google-oauth-config.json');

async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function findUserById(id) {
  const users = await readUsers();
  return users.find(user => user.id === id);
}

async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find(user => user.email === email);
}

async function createUser(userData) {
  const users = await readUsers();
  const newUser = {
    id: Date.now().toString(),
    ...userData,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  await writeUsers(users);
  return newUser;
}

function configurePassport(passport) {
  passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  }, async (email, password, done) => {
    try {
      const user = await findUserByEmail(email);
      if (!user) {
        return done(null, false, { message: 'No user with that email' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (isMatch) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Password incorrect' });
      }
    } catch (error) {
      return done(error);
    }
  }));

  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CONFIG.web.client_id,
    clientSecret: GOOGLE_CONFIG.web.client_secret,
    callbackURL: GOOGLE_CONFIG.web.redirect_uris[0]
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await findUserByEmail(profile.emails[0].value);
      
      if (user) {
        return done(null, user);
      } else {
        user = await createUser({
          email: profile.emails[0].value,
          name: profile.displayName,
          googleId: profile.id,
          provider: 'google',
          avatar: profile.photos[0].value
        });
        return done(null, user);
      }
    } catch (error) {
      return done(error, null);
    }
  }));

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await findUserById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
}

module.exports = {
  configurePassport,
  findUserByEmail,
  createUser,
  readUsers,
  writeUsers
};