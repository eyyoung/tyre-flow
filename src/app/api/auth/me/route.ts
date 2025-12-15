import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withMiddlewares, authOnlyMiddlewares } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  return withMiddlewares(request, authOnlyMiddlewares, async (ctx) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user?.userId },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      if (!user) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({ user });
    } catch (error) {
      console.error('Get current user error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
