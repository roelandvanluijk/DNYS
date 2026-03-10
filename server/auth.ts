import { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET || "dnys-reconciliatie-secret-change-me";

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production" && process.env.TRUST_PROXY === "true",
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db.select().from(users).where(eq(users.username, username));
        if (!user) return done(null, false, { message: "Onjuiste gebruikersnaam" });
        const isValid = await comparePasswords(password, user.password);
        if (!isValid) return done(null, false, { message: "Onjuist wachtwoord" });
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      done(null, user || null);
    } catch (err) {
      done(err);
    }
  });

  // Login endpoint
  app.post("/api/auth/login", (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Login mislukt" });
      req.logIn(user, (err) => {
        if (err) return next(err);
        return res.json({ id: user.id, username: user.username });
      });
    })(req, res, next);
  });

  // Logout endpoint
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout mislukt" });
      res.json({ message: "Uitgelogd" });
    });
  });

  // Current user endpoint
  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Niet ingelogd" });
    const user = req.user as any;
    res.json({ id: user.id, username: user.username });
  });

  // Seed initial admin user if no users exist
  seedAdminUser();
}

// Middleware to protect API routes
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Niet ingelogd" });
}

async function seedAdminUser() {
  try {
    const existing = await db.select().from(users);
    if (existing.length === 0) {
      const defaultPassword = process.env.ADMIN_PASSWORD || "dnys2024";
      const hashed = await hashPassword(defaultPassword);
      await db.insert(users).values({
        id: randomBytes(8).toString("hex"),
        username: "admin",
        password: hashed,
      });
      console.log("[auth] Created default admin user (username: admin). Change the password via ADMIN_PASSWORD env var.");
    }
  } catch (err) {
    // Table might not exist yet on first run before migrations
    console.log("[auth] Could not seed admin user (table may not exist yet):", (err as Error).message);
  }
}
