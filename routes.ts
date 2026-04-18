import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { setupAuth, isAuthenticated } 
from "./replit_integrations/auth/replitAuth";

import { registerAuthRoutes } 
from "./replit_integrations/auth/routes";

import { openai } from "./replit_integrations/image/client";
import { authStorage } from "./replit_integrations/auth/storage";

// Setup Multer
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// AI Categorization Helper
async function categorizeReport(description: string): Promise<string> {
  const lower = description.toLowerCase();
  
  if (lower.match(/garbage|trash|waste|rubbish|bin/)) return "Sanitation";
  if (lower.match(/pothole|road|street|traffic|pavement/)) return "Roads";
  if (lower.match(/water|leak|pipe|drain|flood/)) return "Water Supply";
  if (lower.match(/light|electric|power|pole|dark/)) return "Electricity";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        {
          role: "system",
          content: `You are a Smart City assistant. Categorize the following civic issue into one of these exact categories: "Sanitation", "Roads", "Water Supply", "Electricity", or "General". Return ONLY the category name.`
        },
        { role: "user", content: description }
      ],
      max_completion_tokens: 10,
    });
    
    const category = response.choices[0]?.message?.content?.trim();
    const validCategories = ["Sanitation", "Roads", "Water Supply", "Electricity", "General"];
    
    if (category && validCategories.includes(category)) {
      return category;
    }
  } catch (error) {
    console.error("AI categorization failed:", error);
  }
  
  return "General";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
 if (process.env.NODE_ENV === "production") {
  await setupAuth(app);
  registerAuthRoutes(app);
}


  app.use('/uploads', express.static(uploadDir));

  // List reports
  app.get(api.reports.list.path, isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const dbUser = await authStorage.getUser(user.claims.sub);
    const isAdmin = dbUser?.role === 'admin';

    if (isAdmin) {
      const reports = await storage.getReports();
      res.json(reports);
    } else {
      const reports = await storage.getUserReports(user.claims.sub);
      res.json(reports);
    }
  });

  // Get single report
  app.get(api.reports.get.path, isAuthenticated, async (req, res) => {
    const report = await storage.getReport(Number(req.params.id));
    if (!report) return res.status(404).json({ message: "Report not found" });
    
    const user = req.user as any;
    const dbUser = await authStorage.getUser(user.claims.sub);
    if (report.userId !== user.claims.sub && dbUser?.role !== 'admin') {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json(report);
  });

  // Create report
  app.post(api.reports.create.path, isAuthenticated, async (req, res) => {
    try {
      const input = api.reports.create.input.parse(req.body);
      const user = req.user as any;
      
      const category = await categorizeReport(input.description);

      const report = await storage.createReport({
        ...input,
        status: "Pending",
        category,
        userId: user.claims.sub
      });

      res.status(201).json(report);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Update Status
  app.patch(api.reports.updateStatus.path, isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const dbUser = await authStorage.getUser(user.claims.sub);
    
    if (dbUser?.role !== 'admin') {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { status } = req.body;
    const report = await storage.updateReportStatus(Number(req.params.id), status);
    
    if (!report) return res.status(404).json({ message: "Report not found" });
    res.json(report);
  });

  // File Upload
  app.post(api.upload.create.path, isAuthenticated, upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });

  return httpServer;
}
