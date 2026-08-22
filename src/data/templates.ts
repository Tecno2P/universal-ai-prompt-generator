import type { PromptTemplate } from '@/types'

const now = Date.now()

// Helper to keep template definitions compact
const t = (
  id: string, category: string, title: string, content: string,
  tags: string[], keywords: string[], style: PromptTemplate['style'] = 'professional',
  language: PromptTemplate['language'] = 'en',
): PromptTemplate => ({
  id, category, title, content, tags, keywords, style, language,
  createdAt: now, updatedAt: now, source: 'builtin', version: 1,
})

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  // ── Web Development ──
  t('web-modern-001', 'web-development', 'Modern Responsive Website',
    `You are an expert full-stack web developer.\n\nContext: I need a modern, fully responsive website with clean design and smooth performance on all devices.\n\nObjective: Build a complete website using React, TypeScript, and Tailwind CSS.\n\nRequirements:\n- Responsive layout (mobile-first)\n- Modern, clean UI with subtle animations\n- SEO-friendly semantic HTML\n- Accessible (ARIA, keyboard nav)\n- Fast load time (< 2s)\n\nOutput: Complete, production-ready code organized into components with a brief explanation.\n\nQuality Criteria: Code must be clean, typed, and follow best practices.`,
    ['web', 'react', 'responsive', 'modern'], ['website', 'web', 'modern', 'responsive']),

  t('web-dashboard-001', 'web-development', 'Admin Dashboard',
    `You are a senior frontend engineer specializing in dashboard design.\n\nObjective: Create a modern admin dashboard with charts, tables, and real-time data display.\n\nRequirements:\n- Sidebar navigation with collapsible menu\n- Data tables with sorting, filtering, pagination\n- Charts (line, bar, pie) using a lightweight library\n- Dark/light theme toggle\n- Responsive grid layout\n\nConstraints: Use React + TypeScript + Tailwind. Avoid heavy dependencies.\n\nOutput Format: Full component code with mock data.`,
    ['dashboard', 'admin', 'charts', 'react'], ['dashboard', 'admin', 'panel']),

  t('web-portfolio-001', 'resume', 'Developer Portfolio Website',
    `You are a creative web developer with an eye for design.\n\nObjective: Build a stunning personal portfolio website.\n\nRequirements:\n- Hero section with name and tagline\n- Projects showcase with cards\n- About section\n- Contact form\n- Smooth scroll animations\n- Mobile responsive\n\nStyle: Modern, minimal, with glassmorphism effects.\n\nOutput: Complete code with all sections.`,
    ['portfolio', 'website', 'personal'], ['portfolio', 'resume']),

  // ── React ──
  t('react-component-001', 'react', 'Reusable React Component',
    `You are a React expert focused on building accessible, reusable components.\n\nObjective: Create a reusable, accessible {{componentType}} component.\n\nRequirements:\n- TypeScript with proper prop types\n- Accessible (ARIA roles, keyboard support)\n- Customizable via props\n- Includes Tailwind styling\n- Handles loading and error states\n\nOutput: Component code + usage example.`,
    ['react', 'component', 'typescript'], ['react', 'component']),

  // ── API ──
  t('api-rest-001', 'api', 'REST API Design',
    `You are a backend architect.\n\nObjective: Design and implement a RESTful API for {{domain}}.\n\nRequirements:\n- Proper HTTP methods (GET, POST, PUT, DELETE)\n- Authentication (JWT)\n- Input validation\n- Error handling with proper status codes\n- API documentation (OpenAPI)\n\nConstraints: Use Node.js + Express or Python + FastAPI.\n\nOutput: Complete code + documentation.`,
    ['api', 'rest', 'backend'], ['api', 'backend', 'rest', 'endpoint']),

  // ── Database ──
  t('db-schema-001', 'database', 'Database Schema Design',
    `You are a database architect.\n\nObjective: Design an optimized database schema for {{application}}.\n\nRequirements:\n- Normalized tables (3NF)\n- Proper indexes for query optimization\n- Foreign key relationships\n- Constraints and defaults\n\nOutput: SQL schema (PostgreSQL) + ER diagram description.\n\nQuality Criteria: Schema must handle scale and avoid common anti-patterns.`,
    ['database', 'schema', 'sql'], ['database', 'db', 'schema', 'data']),

  // ── Python ──
  t('python-script-001', 'python', 'Python Automation Script',
    `You are a Python automation expert.\n\nObjective: Write a Python script that {{task}}.\n\nRequirements:\n- Clean, documented code with type hints\n- Error handling with try/except\n- CLI arguments (argparse)\n- Logging\n- Requirements.txt\n\nOutput: Complete script ready to run.`,
    ['python', 'automation', 'script'], ['python', 'script', 'automation']),

  // ── DevOps ──
  t('devops-cicd-001', 'devops', 'CI/CD Pipeline',
    `You are a DevOps engineer.\n\nObjective: Create a CI/CD pipeline configuration for {{project}}.\n\nRequirements:\n- Automated build and test\n- Linting and type checking\n- Deploy on merge to main\n- Environment variables management\n- Rollback on failure\n\nOutput: GitHub Actions / GitLab CI YAML file with comments.`,
    ['devops', 'cicd', 'pipeline', 'github-actions'], ['devops', 'ci', 'cd', 'pipeline', 'deploy']),

  // ── Debugging ──
  t('debug-fix-001', 'debugging', 'Debug & Fix Code',
    `You are a debugging expert.\n\nObjective: Find and fix the bug in the following code.\n\nInputs:\n\`\`\`\n{{code}}\n\`\`\`\n\nError message: {{error}}\n\nSteps:\n1. Analyze the root cause\n2. Explain the bug\n3. Provide the fixed code\n4. Suggest preventive measures\n\nOutput: Explanation + corrected code.`,
    ['debug', 'fix', 'bug'], ['debug', 'fix', 'error', 'bug']),

  // ── Android ──
  t('android-app-001', 'android', 'Android App Feature',
    `You are an experienced Android developer.\n\nObjective: Implement {{feature}} for an Android app using Kotlin.\n\nRequirements:\n- MVVM architecture\n- Jetpack Compose UI\n- ViewModels and StateFlow\n- Proper lifecycle handling\n- Material Design 3\n\nOutput: Complete Kotlin code with composables and viewmodel.`,
    ['android', 'kotlin', 'jetpack'], ['android', 'app', 'kotlin']),

  // ── Creative: Image Generation ──
  t('img-gen-001', 'image-gen', 'AI Image Generation Prompt',
    `You are a prompt engineer for AI image generation.\n\nObjective: Create a detailed image generation prompt for {{subject}}.\n\nRequirements:\n- Art style specification\n- Lighting and mood\n- Composition and camera angle\n- Color palette\n- Quality modifiers (4K, detailed, sharp focus)\n- Negative prompts if applicable\n\nOutput: A single optimized prompt string ready for Stable Diffusion / DALL-E / Midjourney.`,
    ['image', 'ai-art', 'prompt'], ['image', 'photo', 'picture', 'art']),

  // ── Story ──
  t('story-write-001', 'story', 'Short Story',
    `You are a creative writer.\n\nObjective: Write a short story about {{theme}}.\n\nRequirements:\n- 1000-2000 words\n- Engaging opening hook\n- Well-developed characters\n- Clear plot arc (setup, conflict, resolution)\n- Vivid descriptions\n\nStyle: {{tone}}\n\nOutput: Complete story with a title.`,
    ['story', 'creative', 'writing'], ['story', 'kahani', 'write']),

  // ── Blog ──
  t('blog-write-001', 'blog', 'SEO Blog Post',
    `You are an expert content writer and SEO specialist.\n\nObjective: Write a comprehensive blog post on {{topic}}.\n\nRequirements:\n- 1500-2500 words\n- Engaging H1, H2, H3 structure\n- SEO-optimized (target keyword in title, headings, intro)\n- Introduction with hook\n- Actionable takeaways\n- FAQ section\n- Meta description\n\nOutput: Markdown-formatted blog post.`,
    ['blog', 'seo', 'content', 'writing'], ['blog', 'article', 'post', 'content']),

  // ── Email ──
  t('email-write-001', 'email', 'Professional Email',
    `You are a professional communication expert.\n\nObjective: Write a {{type}} email to {{recipient}} about {{subject}}.\n\nRequirements:\n- Clear subject line\n- Professional tone\n- Concise (under 200 words)\n- Call to action\n- Proper greeting and sign-off\n\nOutput: Complete email ready to send.`,
    ['email', 'professional', 'communication'], ['email', 'mail', 'message']),

  // ── Resume ──
  t('resume-build-001', 'resume', 'Professional Resume',
    `You are a professional resume writer.\n\nObjective: Create a polished resume for a {{role}} position.\n\nInputs:\n- Name: {{name}}\n- Experience: {{experience}}\n- Skills: {{skills}}\n\nRequirements:\n- ATS-friendly format\n- Professional summary\n- Quantified achievements\n- Skills section\n- Clean, modern layout\n\nOutput: Resume content in Markdown.`,
    ['resume', 'cv', 'career'], ['resume', 'cv', 'biodata']),

  // ── Marketing ──
  t('mkt-campaign-001', 'marketing', 'Marketing Campaign',
    `You are a marketing strategist.\n\nObjective: Design a marketing campaign for {{product}}.\n\nRequirements:\n- Target audience analysis\n- Key messaging pillars\n- Channel strategy (social, email, paid)\n- Content calendar (4 weeks)\n- KPIs and success metrics\n- Budget allocation suggestions\n\nOutput: Comprehensive campaign brief.`,
    ['marketing', 'campaign', 'strategy'], ['marketing', 'campaign', 'ad']),

  // ── Social Media ──
  t('social-post-001', 'social-media', 'Social Media Content',
    `You are a social media content creator.\n\nObjective: Create a week of social media posts for {{platform}} about {{topic}}.\n\nRequirements:\n- 7 posts (one per day)\n- Engaging hooks\n- Relevant hashtags\n- Mix of formats (text, question, tip, story)\n- Call to action\n\nOutput: Table with day, post content, and hashtags.`,
    ['social-media', 'content', 'posts'], ['social', 'post', 'instagram', 'twitter']),

  // ── Research / Summarization ──
  t('summarize-001', 'summarization', 'Content Summarization',
    `You are a summarization expert.\n\nObjective: Summarize the following content into key points.\n\nInputs:\n{{content}}\n\nRequirements:\n- Executive summary (2-3 sentences)\n- 5-7 key bullet points\n- Important quotes if any\n- Conclusion\n\nOutput Format: Markdown with clear sections.`,
    ['summary', 'research', 'notes'], ['summarize', 'summary', 'short']),

  // ── Analysis ──
  t('analyze-001', 'analysis', 'Data Analysis',
    `You are a data analyst.\n\nObjective: Analyze the following data and provide insights.\n\nInputs:\n{{data}}\n\nRequirements:\n- Key trends and patterns\n- Statistical summary\n- Outliers or anomalies\n- Recommendations\n- Visual suggestions (chart types)\n\nOutput: Structured analysis report in Markdown.`,
    ['analysis', 'data', 'insights'], ['analysis', 'analyze', 'data']),

  // ── Academic ──
  t('academic-write-001', 'academic', 'Academic Paper Outline',
    `You are an academic writing assistant.\n\nObjective: Create a detailed outline for an academic paper on {{topic}}.\n\nRequirements:\n- Abstract structure\n- Introduction with thesis\n- Literature review framework\n- Methodology section\n- Results and discussion outline\n- Conclusion\n- Suggested references\n\nOutput: Detailed outline with section descriptions.`,
    ['academic', 'paper', 'research'], ['academic', 'paper', 'research', 'study']),

  // ── Business / Startup ──
  t('startup-pitch-001', 'startup', 'Startup Pitch Deck',
    `You are a startup advisor.\n\nObjective: Create a pitch deck outline for {{startup}}.\n\nRequirements:\n- Problem statement\n- Solution\n- Market size (TAM, SAM, SOM)\n- Business model\n- Traction / milestones\n- Team\n- Financial projections\n- Ask\n\nOutput: 10-slide deck outline with key talking points.`,
    ['startup', 'pitch', 'business'], ['startup', 'business', 'pitch']),

  // ── Business Plan ──
  t('business-plan-001', 'business-plan', 'Business Plan',
    `You are a business consultant.\n\nObjective: Draft a comprehensive business plan for {{business}}.\n\nRequirements:\n- Executive summary\n- Company description\n- Market analysis\n- Product/service line\n- Marketing & sales strategy\n- Financial projections (3-year)\n- Funding requirements\n\nOutput: Structured business plan document.`,
    ['business', 'plan', 'strategy'], ['business', 'plan', 'company']),

  // ── SEO ──
  t('seo-strategy-001', 'seo', 'SEO Strategy',
    `You are an SEO expert.\n\nObjective: Create an SEO strategy for {{website}}.\n\nRequirements:\n- Keyword research (primary + secondary)\n- On-page optimization checklist\n- Content gap analysis approach\n- Technical SEO audit items\n- Link building strategy\n- 3-month roadmap\n\nOutput: Actionable SEO strategy document.`,
    ['seo', 'ranking', 'google'], ['seo', 'ranking', 'google', 'optimize']),

  // ── Product Strategy ──
  t('product-strategy-001', 'product-strategy', 'Product Strategy Document',
    `You are a senior product manager.\n\nObjective: Create a product strategy for {{product}}.\n\nRequirements:\n- Vision and mission\n- Target personas\n- Competitive landscape\n- Key features / differentiators\n- Roadmap (quarterly)\n- Success metrics (KPIs)\n\nOutput: Product strategy document.`,
    ['product', 'strategy', 'roadmap'], ['product', 'strategy']),

  // ── Education: Teacher ──
  t('teacher-lesson-001', 'teacher', 'Lesson Plan',
    `You are an experienced educator.\n\nObjective: Create a detailed lesson plan for teaching {{topic}} to {{grade}}.\n\nRequirements:\n- Learning objectives\n- Materials needed\n- Introduction (hook)\n- Main activity\n- Group work / discussion\n- Assessment / exit ticket\n- Homework\n- Duration: 45 min\n\nOutput: Structured lesson plan.`,
    ['education', 'lesson', 'teacher'], ['teacher', 'lesson', 'education']),

  // ── Student / Study Plan ──
  t('study-plan-001', 'study-plan', 'Study Plan',
    `You are an academic coach.\n\nObjective: Create a personalized study plan for {{subject}} exam preparation.\n\nInputs:\n- Subject: {{subject}}\n- Exam date: {{date}}\n- Available hours/day: {{hours}}\n\nRequirements:\n- Weekly schedule\n- Topic prioritization\n- Practice test schedule\n- Revision slots\n- Break recommendations\n\nOutput: Table-based study calendar.`,
    ['study', 'plan', 'education'], ['study', 'learn', 'padhai', 'exam']),

  // ── Quiz ──
  t('quiz-create-001', 'quiz', 'Quiz Generator',
    `You are an assessment designer.\n\nObjective: Create a quiz on {{topic}}.\n\nRequirements:\n- 10 multiple-choice questions\n- 4 options each\n- One correct answer\n- Difficulty mix (easy, medium, hard)\n- Explanations for each answer\n\nOutput: JSON array with question, options, correctIndex, explanation.`,
    ['quiz', 'test', 'assessment'], ['quiz', 'test', 'exam']),

  // ── Hinglish templates ──
  t('hinglish-website-001', 'web-development', 'Hinglish: Website Banani Hai',
    `Aap ek expert web developer hain.\n\nObjective: Ek modern, responsive website banao jo mobile aur desktop dono pe smooth chale.\n\nRequirements:\n- Mobile-first responsive design\n- Modern UI with subtle animations\n- Fast loading speed\n- SEO-friendly\n- Clean, professional look\n\nOutput: Complete React + Tailwind code with explanation.`,
    ['hinglish', 'website', 'hindi'], ['website', 'banani', 'modern', 'smooth'], 'professional', 'hinglish'),

  t('hinglish-dashboard-001', 'web-development', 'Hinglish: Dashboard Banao',
    `Aap ek senior frontend engineer hain.\n\nObjective: Ek premium dashboard banao with smooth animations aur real-time data display.\n\nRequirements:\n- Sidebar navigation\n- Charts (line, bar, pie)\n- Data tables with filtering\n- Dark/light theme\n- Mobile responsive\n\nConstraints: React + TypeScript + Tailwind use karo.\n\nOutput: Full component code.`,
    ['hinglish', 'dashboard', 'hindi'], ['dashboard', 'premium', 'animations'], 'professional', 'hinglish'),

  // ── Creative: Design ──
  t('design-system-001', 'design', 'Design System',
    `You are a UI/UX design systems expert.\n\nObjective: Create a design system specification for {{product}}.\n\nRequirements:\n- Color palette (primary, secondary, neutral, semantic)\n- Typography scale\n- Spacing system\n- Component variants (buttons, inputs, cards)\n- Dark mode support\n- Accessibility guidelines\n\nOutput: Design tokens (JSON) + usage documentation.`,
    ['design', 'system', 'ui'], ['design', 'system', 'ui']),

  // ── Video Generation ──
  t('video-gen-001', 'video-gen', 'AI Video Generation Prompt',
    `You are a prompt engineer for AI video generation.\n\nObjective: Create a detailed video generation prompt for {{scene}}.\n\nRequirements:\n- Scene description\n- Camera movement (pan, zoom, orbit)\n- Lighting and atmosphere\n- Duration and pacing\n- Style reference\n\nOutput: Optimized prompt string for video AI tools.`,
    ['video', 'ai', 'prompt'], ['video', 'animation', 'generate']),

  // ── Node.js ──
  t('nodejs-backend-001', 'nodejs', 'Node.js Backend Service',
    `You are a Node.js backend expert.\n\nObjective: Build a {{service}} backend service.\n\nRequirements:\n- Express or Fastify framework\n- RESTful routes\n- Middleware (auth, logging, error handling)\n- Database integration (Prisma/Mongoose)\n- Input validation (Zod)\n- Environment config\n\nOutput: Complete project structure with code.`,
    ['nodejs', 'backend', 'express'], ['node', 'backend', 'server']),

  // ── TypeScript ──
  t('typescript-util-001', 'typescript', 'TypeScript Utility',
    `You are a TypeScript expert.\n\nObjective: Create a well-typed utility for {{purpose}}.\n\nRequirements:\n- Strict TypeScript with generics\n- Proper type inference\n- Unit tests\n- JSDoc documentation\n- Edge case handling\n\nOutput: Utility code + test file.`,
    ['typescript', 'utility', 'types'], ['typescript', 'types', 'utility']),

  // ── JavaScript ──
  t('js-algorithm-001', 'javascript', 'JavaScript Algorithm',
    `You are a JavaScript algorithms expert.\n\nObjective: Implement {{algorithm}} efficiently.\n\nRequirements:\n- Clean, readable code (ES6+)\n- Time and space complexity analysis\n- Edge case handling\n- Unit tests\n- Usage examples\n\nOutput: Solution + tests + complexity notes.`,
    ['javascript', 'algorithm', 'dsa'], ['javascript', 'algorithm', 'js']),

  // ── iOS ──
  t('ios-app-001', 'ios', 'iOS App Feature',
    `You are a senior iOS developer.\n\nObjective: Implement {{feature}} for an iOS app using Swift.\n\nRequirements:\n- SwiftUI\n- MVVM architecture\n- Combine framework\n- Proper state management\n- Accessibility support\n\nOutput: Complete Swift code.`,
    ['ios', 'swift', 'swiftui'], ['ios', 'swift', 'apple']),

  // ── Productivity / General ──
  t('productivity-plan-001', 'business', 'Productivity Action Plan',
    `You are a productivity coach.\n\nObjective: Create a personalized productivity plan.\n\nInputs:\n- Goal: {{goal}}\n- Timeframe: {{timeframe}}\n- Current challenges: {{challenges}}\n\nRequirements:\n- Daily routine structure\n- Priority framework (Eisenhower matrix)\n- Habit tracking suggestions\n- Weekly review process\n- Accountability tips\n\nOutput: Actionable plan document.`,
    ['productivity', 'plan', 'goals'], ['productivity', 'plan', 'routine']),

  // ── Customer Support ──
  t('support-001', 'business', 'Customer Support Response',
    `You are a customer support specialist.\n\nObjective: Write a helpful response to a customer complaint about {{issue}}.\n\nRequirements:\n- Empathetic tone\n- Clear solution or next steps\n- Professional language\n- Apology if appropriate\n- Follow-up offer\n\nOutput: Email-ready response.`,
    ['support', 'customer', 'response'], ['support', 'customer', 'help']),

  // ── Sales ──
  t('sales-pitch-001', 'business', 'Sales Pitch',
    `You are a sales expert.\n\nObjective: Write a compelling sales pitch for {{product}} targeting {{audience}}.\n\nRequirements:\n- Strong opening hook\n- Pain point identification\n- Solution presentation\n- Social proof\n- Clear CTA\n\nOutput: Pitch script (200-300 words).`,
    ['sales', 'pitch', 'business'], ['sales', 'pitch', 'sell']),

  // ── Flashcards ──
  t('flashcards-001', 'education', 'Study Flashcards',
    `You are an education content creator.\n\nObjective: Create flashcards for {{topic}}.\n\nRequirements:\n- 20 flashcards\n- Front: question / term\n- Back: answer / definition\n- Difficulty progression\n- Cover key concepts\n\nOutput: JSON array [{front, back}].`,
    ['flashcards', 'study', 'education'], ['flashcards', 'study', 'learn']),

  // ── Explanation ──
  t('explain-001', 'education', 'Concept Explanation',
    `You are an expert teacher.\n\nObjective: Explain {{concept}} in a clear, engaging way.\n\nRequirements:\n- Simple definition\n- Real-world analogy\n- Step-by-step breakdown\n- Common misconceptions\n- Practical example\n- Summary\n\nTarget audience: {{level}}\n\nOutput: Structured explanation.`,
    ['explanation', 'education', 'learn'], ['explain', 'understand', 'concept']),
]
