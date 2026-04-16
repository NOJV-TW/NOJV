-- Course-level archive flag. When true, students keep score visibility
-- but lose click-through into assignment / problem details. Toggled by
-- course managers via the (forthcoming) settings UI.
ALTER TABLE "Course" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
