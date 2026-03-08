import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@nojv/db";

const registerSchema = z.object({
  displayName: z.string().min(1).max(100),
  email: z.string().email(),
  handle: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9._-]+$/),
  password: z.string().min(8).max(128)
});

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await request.json());
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: body.email }, { handle: body.handle }]
      }
    });

    if (existing) {
      const field = existing.email === body.email ? "email" : "handle";

      return NextResponse.json(
        { message: `This ${field} is already taken.` },
        { status: 409 }
      );
    }

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

    return NextResponse.json(
      { message: "Registration failed." },
      { status: 500 }
    );
  }
}
