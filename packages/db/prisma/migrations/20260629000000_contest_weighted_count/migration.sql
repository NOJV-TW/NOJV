-- Add the 積分制 (weighted_count) contest scoring mode between problem_count and point_sum.
ALTER TYPE "ContestScoringMode" ADD VALUE 'weighted_count' BEFORE 'point_sum';
