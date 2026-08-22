import type { Category } from '@/types'

export const BUILTIN_CATEGORIES: Category[] = [
  // Coding
  { id: 'coding', name: 'Coding', icon: 'code' },
  { id: 'web-development', name: 'Web Development', parent: 'coding' },
  { id: 'android', name: 'Android', parent: 'coding' },
  { id: 'ios', name: 'iOS', parent: 'coding' },
  { id: 'python', name: 'Python', parent: 'coding' },
  { id: 'javascript', name: 'JavaScript', parent: 'coding' },
  { id: 'typescript', name: 'TypeScript', parent: 'coding' },
  { id: 'react', name: 'React', parent: 'coding' },
  { id: 'nodejs', name: 'Node.js', parent: 'coding' },
  { id: 'devops', name: 'DevOps', parent: 'coding' },
  { id: 'api', name: 'APIs', parent: 'coding' },
  { id: 'database', name: 'Databases', parent: 'coding' },
  { id: 'debugging', name: 'Debugging', parent: 'coding' },
  // Creative
  { id: 'creative', name: 'Creative', icon: 'palette' },
  { id: 'image-gen', name: 'Image Generation', parent: 'creative' },
  { id: 'video-gen', name: 'Video Generation', parent: 'creative' },
  { id: 'story', name: 'Story', parent: 'creative' },
  { id: 'design', name: 'Design', parent: 'creative' },
  // Writing
  { id: 'writing', name: 'Writing', icon: 'pen' },
  { id: 'blog', name: 'Blog', parent: 'writing' },
  { id: 'email', name: 'Email', parent: 'writing' },
  { id: 'resume', name: 'Resume / CV', parent: 'writing' },
  { id: 'marketing', name: 'Marketing', parent: 'writing' },
  { id: 'social-media', name: 'Social Media', parent: 'writing' },
  // Research
  { id: 'research', name: 'Research', icon: 'search' },
  { id: 'summarization', name: 'Summarization', parent: 'research' },
  { id: 'analysis', name: 'Analysis', parent: 'research' },
  { id: 'academic', name: 'Academic Writing', parent: 'research' },
  // Business
  { id: 'business', name: 'Business', icon: 'briefcase' },
  { id: 'startup', name: 'Startup', parent: 'business' },
  { id: 'business-plan', name: 'Business Plan', parent: 'business' },
  { id: 'seo', name: 'SEO', parent: 'business' },
  { id: 'product-strategy', name: 'Product Strategy', parent: 'business' },
  // Education
  { id: 'education', name: 'Education', icon: 'graduation' },
  { id: 'teacher', name: 'Teacher', parent: 'education' },
  { id: 'student', name: 'Student', parent: 'education' },
  { id: 'quiz', name: 'Quiz', parent: 'education' },
  { id: 'study-plan', name: 'Study Plan', parent: 'education' },
]
