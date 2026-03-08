import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@nojv/db";

const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email(),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  password: z.string().min(8).max(128)
});

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: {
        displayName: body.displayName,
        email: body.email,
        handle: body.handle,
        passwordHash,
        platformRole: "student"
      }
    });

    return NextResponse.json(
      { handle: user.handle, id: user.id },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { issues: error.issues, message: "Invalid registration payload." },
        { status: 400 }
      );
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const meta = "meta" in error ? (error.meta as { target?: string[] }) : undefined;
      const field = meta?.target?.includes("email") ? "email" : "handle";

      return NextResponse.json(
        { message: `This ${field} is already taken.` },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: "Registration failed." },
      { status: 500 }
    );
  }
}
